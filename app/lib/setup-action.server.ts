import { randomUUID } from "node:crypto";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildLlmsTxtPrompt } from "./llmo-prompt.server";
import {
  createOrUpdateLlmsTxtFile,
  createOrUpdateLlmsFullTxtFile,
  createOrUpdateAiContextFile,
  createOrUpdateDocsAiFiles,
  setupAllUrlRedirects,
  type DocsAiFileEntry,
} from "./llmo-files.server";
import {
  getDecryptedOpenAiKey,
  generateLlmsTxtBody,
  generateLlmsTxtBodyRefinement,
  refineLlmsFullTxt,
  generateAiContextBody,
  refineAiContextBody,
} from "./openai.server";
import { fetchStoreData, formatStoreDataAsText } from "./llmo-full.server";
import { encrypt } from "./encrypt.server";

const MAX_DOCS_AI_ROWS = 10;

function getPromptInput(formData: FormData) {
  return {
    siteType: (formData.get("siteType") as string) ?? "",
    title: (formData.get("title") as string) ?? "",
    roleSummary: (formData.get("roleSummary") as string) ?? "",
    sectionsOutline: (formData.get("sectionsOutline") as string) ?? "",
    notesForAi: (formData.get("notesForAi") as string) ?? "",
    industry: (formData.get("industry") as string)?.trim() || undefined,
    target: (formData.get("target") as string)?.trim() || undefined,
    productType: (formData.get("productType") as string)?.trim() || undefined,
    docsAiFiles: undefined as { filename: string; fileUrl?: string | null }[] | undefined,
  };
}

export async function handleSetupAction(request: Request): Promise<Response> {
  const { session, admin } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  if (!shop) {
    return Response.json({ error: "No shop" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;

  if (intent === "getPrompt") {
    const count = Math.min(parseInt(String(formData.get("docsAiCount") || "0"), 10) || 0, MAX_DOCS_AI_ROWS);
    const docsAiFiles: { filename: string; fileUrl?: string | null }[] = [];
    for (let i = 0; i < count; i++) {
      const filename = (formData.get(`docsAiFilename_${i}`) as string)?.trim();
      if (!filename) continue;
      const fileUrl = (formData.get(`docsAiFileUrl_${i}`) as string)?.trim() || null;
      docsAiFiles.push({ filename, fileUrl });
    }
    const input = getPromptInput(formData);
    input.docsAiFiles = docsAiFiles.length ? docsAiFiles : undefined;
    const prompt = buildLlmsTxtPrompt(input);
    return Response.json({ prompt });
  }

  if (intent === "generateLlmsTxt") {
    try {
      const count = Math.min(parseInt(String(formData.get("docsAiCount") || "0"), 10) || 0, MAX_DOCS_AI_ROWS);
      const docsAiFiles: { filename: string; fileUrl?: string | null }[] = [];
      for (let i = 0; i < count; i++) {
        const filename = (formData.get(`docsAiFilename_${i}`) as string)?.trim();
        if (!filename) continue;
        const fileUrl = (formData.get(`docsAiFileUrl_${i}`) as string)?.trim() || null;
        docsAiFiles.push({ filename, fileUrl });
      }
      const input = getPromptInput(formData);
      input.docsAiFiles = docsAiFiles.length ? docsAiFiles : undefined;
      const prompt = buildLlmsTxtPrompt(input);
      const apiKey = await getDecryptedOpenAiKey(shop);
      if (!apiKey) {
        return Response.json({ error: "API_KEY_REQUIRED" }, { status: 400 });
      }
      const result = await generateLlmsTxtBody(prompt, apiKey);
      if (!result.ok) {
        return Response.json({ error: result.error ?? "OPENAI_ERROR" }, { status: 502 });
      }
      return Response.json({ body: result.body });
    } catch (err) {
      console.error("[ap-llmo] generateLlmsTxt error:", err);
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: "GENERATE_FAILED", message: message.slice(0, 200) },
        { status: 500 }
      );
    }
  }

  if (intent === "refineLlmsTxt") {
    try {
      const currentBody = (formData.get("llmsTxtBody") as string)?.trim() ?? "";
      const refinementNote = (formData.get("refinementNote") as string)?.trim() ?? "";
      if (!currentBody) {
        return Response.json({ error: "REFINE_BODY_EMPTY" }, { status: 400 });
      }
      if (!refinementNote) {
        return Response.json({ error: "REFINE_NOTE_EMPTY" }, { status: 400 });
      }
      const apiKey = await getDecryptedOpenAiKey(shop);
      if (!apiKey) {
        return Response.json({ error: "API_KEY_REQUIRED" }, { status: 400 });
      }
      const result = await generateLlmsTxtBodyRefinement(currentBody, refinementNote, apiKey);
      if (!result.ok) {
        return Response.json({ error: result.error ?? "OPENAI_ERROR" }, { status: 502 });
      }
      return Response.json({ body: result.body });
    } catch (err) {
      console.error("[ap-llmo] refineLlmsTxt error:", err);
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: "GENERATE_FAILED", message: message.slice(0, 200) },
        { status: 500 }
      );
    }
  }

  if (intent === "save") {
    const count = Math.min(parseInt(String(formData.get("docsAiCount") || "0"), 10) || 0, MAX_DOCS_AI_ROWS);
    const docs: DocsAiFileEntry[] = [];
    for (let i = 0; i < count; i++) {
      const filename = (formData.get(`docsAiFilename_${i}`) as string)?.trim() ?? "";
      const content = (formData.get(`docsAiContent_${i}`) as string) ?? "";
      const fileId = (formData.get(`docsAiFileId_${i}`) as string)?.trim() || null;
      const fileUrl = (formData.get(`docsAiFileUrl_${i}`) as string)?.trim() || null;
      docs.push({ filename, content, fileId: fileId || undefined, fileUrl: fileUrl || undefined });
    }
    const uploadedDocs = await createOrUpdateDocsAiFiles(admin, docs);

    const openaiApiKeyRaw = (formData.get("openaiApiKey") as string)?.trim() ?? "";
    const openaiApiKeyEncrypted =
      openaiApiKeyRaw.length > 0
        ? (() => {
            try {
              return encrypt(openaiApiKeyRaw);
            } catch {
              return null;
            }
          })()
        : null;

    const baseCreate = {
      shop,
      siteType: (formData.get("siteType") as string) || null,
      title: (formData.get("title") as string) || null,
      roleSummary: (formData.get("roleSummary") as string) || null,
      sectionsOutline: (formData.get("sectionsOutline") as string) || null,
      notesForAi: (formData.get("notesForAi") as string) || null,
      llmsTxtBody: (formData.get("llmsTxtBody") as string) || null,
      docsAiFiles: JSON.stringify(uploadedDocs),
    };
    const baseUpdate = {
      siteType: (formData.get("siteType") as string) || null,
      title: (formData.get("title") as string) || null,
      roleSummary: (formData.get("roleSummary") as string) || null,
      sectionsOutline: (formData.get("sectionsOutline") as string) || null,
      notesForAi: (formData.get("notesForAi") as string) || null,
      llmsTxtBody: (formData.get("llmsTxtBody") as string) || null,
      docsAiFiles: JSON.stringify(uploadedDocs),
    };

    try {
      await prisma.llmoSettings.upsert({
        where: { shop },
        create: {
          ...baseCreate,
          ...(openaiApiKeyEncrypted != null && { openaiApiKey: openaiApiKeyEncrypted }),
        },
        update: {
          ...baseUpdate,
          ...(openaiApiKeyEncrypted != null && { openaiApiKey: openaiApiKeyEncrypted }),
        },
      });
    } catch {
      const id = randomUUID();
      const siteType = (formData.get("siteType") as string) || null;
      const title = (formData.get("title") as string) || null;
      const roleSummary = (formData.get("roleSummary") as string) || null;
      const sectionsOutline = (formData.get("sectionsOutline") as string) || null;
      const notesForAi = (formData.get("notesForAi") as string) || null;
      const llmsTxtBody = (formData.get("llmsTxtBody") as string) || null;
      const docsAiFiles = JSON.stringify(uploadedDocs);
      await prisma.$executeRawUnsafe(
        `INSERT INTO LlmoSettings (id, shop, siteType, title, roleSummary, sectionsOutline, notesForAi, llmsTxtBody, docsAiFiles, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           siteType = VALUES(siteType),
           title = VALUES(title),
           roleSummary = VALUES(roleSummary),
           sectionsOutline = VALUES(sectionsOutline),
           notesForAi = VALUES(notesForAi),
           llmsTxtBody = VALUES(llmsTxtBody),
           docsAiFiles = VALUES(docsAiFiles),
           updatedAt = NOW()`,
        id,
        shop,
        siteType,
        title,
        roleSummary,
        sectionsOutline,
        notesForAi,
        llmsTxtBody,
        docsAiFiles
      );
    }

    const docsForRedirect = uploadedDocs
      .filter((d) => d.filename && d.fileUrl)
      .map((d) => ({ filename: d.filename, fileUrl: d.fileUrl }));
    if (docsForRedirect.length > 0) {
      setupAllUrlRedirects(admin, { docsAiFiles: docsForRedirect }).catch((e) =>
        console.error("[ap-llmo] setupAllUrlRedirects for docs failed:", e)
      );
    }

    return Response.json({ ok: true });
  }

  if (intent === "generateFullTxt") {
    try {
      const useAiRefinement = formData.get("useAiRefinement") === "true";
      const storeData = await fetchStoreData(admin);
      let fullTxtBody = formatStoreDataAsText(storeData);

      if (useAiRefinement) {
        const apiKey = await getDecryptedOpenAiKey(shop);
        if (!apiKey) {
          return Response.json({ error: "API_KEY_REQUIRED" }, { status: 400 });
        }
        const refined = await refineLlmsFullTxt(fullTxtBody, apiKey);
        if (!refined.ok) {
          return Response.json({ error: refined.error ?? "OPENAI_ERROR" }, { status: 502 });
        }
        fullTxtBody = refined.body;
      }

      const existing = await prisma.llmoSettings.findUnique({
        where: { shop },
        select: { llmsFullTxtFileId: true },
      });

      const fullTxtResult = await createOrUpdateLlmsFullTxtFile(
        admin,
        fullTxtBody,
        existing?.llmsFullTxtFileId ?? null
      );

      if (!fullTxtResult.ok) {
        return Response.json({ ok: false, error: fullTxtResult.error }, { status: 400 });
      }

      try {
        await prisma.llmoSettings.upsert({
          where: { shop },
          create: {
            shop,
            llmsFullTxtFileUrl: fullTxtResult.url,
            llmsFullTxtFileId: fullTxtResult.fileId,
            llmsFullTxtGeneratedAt: new Date(),
          },
          update: {
            llmsFullTxtFileUrl: fullTxtResult.url,
            llmsFullTxtFileId: fullTxtResult.fileId,
            llmsFullTxtGeneratedAt: new Date(),
          },
        });
      } catch {
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO LlmoSettings (id, shop, llmsFullTxtFileUrl, llmsFullTxtFileId, llmsFullTxtGeneratedAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, NOW(), NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             llmsFullTxtFileUrl = VALUES(llmsFullTxtFileUrl),
             llmsFullTxtFileId = VALUES(llmsFullTxtFileId),
             llmsFullTxtGeneratedAt = NOW(),
             updatedAt = NOW()`,
          id,
          shop,
          fullTxtResult.url,
          fullTxtResult.fileId
        );
      }

      setupAllUrlRedirects(admin, { llmsFullTxtUrl: fullTxtResult.url }).catch((e) =>
        console.error("[ap-llmo] setupAllUrlRedirects failed:", e)
      );

      return Response.json({ ok: true, url: fullTxtResult.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] generateFullTxt error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (intent === "saveFile") {
    try {
      const llmsTxtBody = (formData.get("llmsTxtBody") as string) ?? "";
      const existing = await prisma.llmoSettings.findUnique({
        where: { shop },
        select: { llmsTxtFileId: true },
      });
      const result = await createOrUpdateLlmsTxtFile(
        admin,
        llmsTxtBody,
        existing?.llmsTxtFileId ?? null
      );

      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: 400 }
        );
      }

      try {
        await prisma.llmoSettings.upsert({
          where: { shop },
          create: {
            shop,
            llmsTxtBody,
            llmsTxtFileUrl: result.url,
            llmsTxtFileId: result.fileId,
          },
          update: {
            llmsTxtBody,
            llmsTxtFileUrl: result.url,
            llmsTxtFileId: result.fileId,
          },
        });
      } catch {
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO LlmoSettings (id, shop, llmsTxtBody, llmsTxtFileUrl, llmsTxtFileId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             llmsTxtBody = VALUES(llmsTxtBody),
             llmsTxtFileUrl = VALUES(llmsTxtFileUrl),
             llmsTxtFileId = VALUES(llmsTxtFileId),
             updatedAt = NOW()`,
          id,
          shop,
          llmsTxtBody,
          result.url,
          result.fileId
        );
      }

      setupAllUrlRedirects(admin, { llmsTxtUrl: result.url, includeSitemapAi: true }).catch((e) =>
        console.error("[ap-llmo] setupAllUrlRedirects failed:", e)
      );

      return Response.json({
        ok: true,
        url: result.url,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] saveFile error:", err);
      return Response.json(
        { ok: false, error: message },
        { status: 500 }
      );
    }
  }

  if (intent === "generateAiContext") {
    try {
      const apiKey = await getDecryptedOpenAiKey(shop);
      if (!apiKey) {
        return Response.json({ error: "API_KEY_REQUIRED" }, { status: 400 });
      }

      const storeData = await fetchStoreData(admin);
      const settings = await prisma.llmoSettings.findUnique({
        where: { shop },
        select: { siteType: true, notesForAi: true },
      });

      const result = await generateAiContextBody(
        {
          shopName: storeData.shopName,
          shopDescription: storeData.shopDescription,
          siteType: settings?.siteType ?? null,
          productCount: storeData.products.length,
          collectionCount: storeData.collections.length,
          vendorCount: new Set(storeData.products.map((p: { vendor: string }) => p.vendor).filter(Boolean)).size,
          hasShippingPolicy: !!storeData.policies?.shipping,
          hasRefundPolicy: !!storeData.policies?.refund,
        },
        settings?.notesForAi ?? null,
        apiKey
      );

      if (!result.ok) {
        return Response.json({ error: result.error }, { status: 502 });
      }

      try {
        await prisma.llmoSettings.upsert({
          where: { shop },
          create: { shop, aiContextBody: result.body },
          update: { aiContextBody: result.body },
        });
      } catch {
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO LlmoSettings (id, shop, aiContextBody, createdAt, updatedAt)
           VALUES (?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE aiContextBody = VALUES(aiContextBody), updatedAt = NOW()`,
          id,
          shop,
          result.body
        );
      }

      return Response.json({ ok: true, body: result.body });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] generateAiContext error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (intent === "refineAiContext") {
    try {
      const currentBody = (formData.get("aiContextBody") as string) ?? "";
      const refinementNote = (formData.get("refinementNote") as string) ?? "";

      if (!currentBody.trim()) {
        return Response.json({ error: "BODY_EMPTY" }, { status: 400 });
      }
      if (!refinementNote.trim()) {
        return Response.json({ error: "NOTE_EMPTY" }, { status: 400 });
      }

      const apiKey = await getDecryptedOpenAiKey(shop);
      if (!apiKey) {
        return Response.json({ error: "API_KEY_REQUIRED" }, { status: 400 });
      }

      const result = await refineAiContextBody(currentBody, refinementNote, apiKey);

      if (!result.ok) {
        return Response.json({ error: result.error }, { status: 502 });
      }

      try {
        await prisma.llmoSettings.upsert({
          where: { shop },
          create: { shop, aiContextBody: result.body },
          update: { aiContextBody: result.body },
        });
      } catch {
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO LlmoSettings (id, shop, aiContextBody, createdAt, updatedAt)
           VALUES (?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE aiContextBody = VALUES(aiContextBody), updatedAt = NOW()`,
          id,
          shop,
          result.body
        );
      }

      return Response.json({ ok: true, body: result.body });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] refineAiContext error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (intent === "saveAiContext") {
    try {
      const aiContextBody = (formData.get("aiContextBody") as string) ?? "";
      if (!aiContextBody.trim()) {
        return Response.json({ error: "BODY_EMPTY" }, { status: 400 });
      }

      const existing = await prisma.llmoSettings.findUnique({
        where: { shop },
        select: { aiContextFileId: true },
      });

      const result = await createOrUpdateAiContextFile(
        admin,
        aiContextBody,
        existing?.aiContextFileId ?? null
      );

      if (!result.ok) {
        return Response.json({ ok: false, error: result.error }, { status: 400 });
      }

      try {
        await prisma.llmoSettings.upsert({
          where: { shop },
          create: {
            shop,
            aiContextBody,
            aiContextFileUrl: result.url,
            aiContextFileId: result.fileId,
            aiContextGeneratedAt: new Date(),
          },
          update: {
            aiContextBody,
            aiContextFileUrl: result.url,
            aiContextFileId: result.fileId,
            aiContextGeneratedAt: new Date(),
          },
        });
      } catch {
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO LlmoSettings (id, shop, aiContextBody, aiContextFileUrl, aiContextFileId, aiContextGeneratedAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             aiContextBody = VALUES(aiContextBody),
             aiContextFileUrl = VALUES(aiContextFileUrl),
             aiContextFileId = VALUES(aiContextFileId),
             aiContextGeneratedAt = NOW(),
             updatedAt = NOW()`,
          id,
          shop,
          aiContextBody,
          result.url,
          result.fileId
        );
      }

      setupAllUrlRedirects(admin, { aiContextUrl: result.url }).catch((e) =>
        console.error("[ap-llmo] setupAllUrlRedirects failed:", e)
      );

      return Response.json({ ok: true, url: result.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] saveAiContext error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

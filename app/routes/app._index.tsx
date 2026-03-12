import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData, useFetcher } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { buildLlmsTxtPrompt } from "../lib/llmo-prompt.server";
import {
  createOrUpdateLlmsTxtFile,
  createOrUpdateLlmsFullTxtFile,
  createOrUpdateAiContextFile,
  createOrUpdateDocsAiFiles,
  setupAllUrlRedirects,
  type DocsAiFileEntry,
} from "../lib/llmo-files.server";
import { getDecryptedOpenAiKey, generateLlmsTxtBody, generateLlmsTxtBodyRefinement, refineLlmsFullTxt, generateAiContextBody, refineAiContextBody } from "../lib/openai.server";
import { fetchStoreData, formatStoreDataAsText } from "../lib/llmo-full.server";
import { extractAiContextData, formatAiContext } from "../lib/llmo-ai-context.server";
import { encrypt } from "../lib/encrypt.server";
import { getTranslations, getLocaleFromRequest } from "../lib/i18n";
import { runDailyJobManually } from "../lib/cron.server";
import { readAndAggregateLlmoAccessLog } from "../lib/llmo-access-log.server";

const MAX_DOCS_AI_ROWS = 10;

function parseDocsAiFromSettings(json: string | null): DocsAiFileEntry[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is DocsAiFileEntry => x && typeof x === "object" && "filename" in x)
      .map((x) => ({
        filename: String(x.filename ?? ""),
        content: String(x.content ?? ""),
        fileId: x.fileId ?? null,
        fileUrl: x.fileUrl ?? null,
      }));
  } catch {
    return [];
  }
}

const emptySettings = {
  siteType: "",
  title: "",
  roleSummary: "",
  sectionsOutline: "",
  notesForAi: "",
  llmsTxtBody: "",
  llmsTxtFileUrl: "",
  llmsFullTxtFileUrl: "",
  llmsFullTxtGeneratedAt: null as string | null,
  aiContextBody: "",
  aiContextFileUrl: "",
  aiContextGeneratedAt: null as string | null,
  docsAiFiles: [] as DocsAiFileEntry[],
  openaiApiKeySet: false,
  reportEmail: "",
  reportEnabled: false,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session?.shop ?? "";
    const storeUrl = shop ? `https://${shop}` : "";
    const locale = getLocaleFromRequest(request);

    // トライアル・課金状態をチェック
    const { syncTrialAndAccess } = await import("../lib/trial.server");
    const trialInfo = await syncTrialAndAccess(admin, shop);

    // openaiApiKey 列がまだない DB でも動くよう、select で列を限定（openaiApiKey は参照しない）
    const settings = shop
      ? await prisma.llmoSettings.findUnique({
          where: { shop },
          select: {
            siteType: true,
            title: true,
            roleSummary: true,
            sectionsOutline: true,
            notesForAi: true,
            llmsTxtBody: true,
            llmsTxtFileUrl: true,
            llmsFullTxtFileUrl: true,
            llmsFullTxtGeneratedAt: true,
            aiContextBody: true,
            aiContextFileUrl: true,
            aiContextGeneratedAt: true,
            docsAiFiles: true,
            reportEmail: true,
            reportEnabled: true,
          },
        })
      : null;

    // API Key が設定済みかだけ別途取得（列がなければ false、値は返さない）
    let openaiApiKeySet = false;
    if (shop) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ openaiApiKey: string | null }[]>(
          "SELECT `openaiApiKey` FROM `LlmoSettings` WHERE shop = ? LIMIT 1",
          shop
        );
        const val = rows[0]?.openaiApiKey;
        openaiApiKeySet = typeof val === "string" && val.length > 0;
      } catch {
        openaiApiKeySet = false;
      }
    }

    const docsAiFiles = parseDocsAiFromSettings(settings?.docsAiFiles ?? null);

    // ユーザーの locale を DB に保存（週次レポートで使用）
    if (shop) {
      prisma.llmoSettings.upsert({
        where: { shop },
        create: { shop, locale },
        update: { locale },
      }).catch(() => {}); // エラーは無視（バックグラウンドで実行）
    }

    // AI Visibility 用: AI ボットアクセス集計（サイドバー表示用）
    let aiVisibility = { aiBotTotal: 0, aiBotByService: {} as Record<string, number> };
    try {
      const logData = await readAndAggregateLlmoAccessLog(shop);
      aiVisibility = {
        aiBotTotal: logData.aiBotTotal,
        aiBotByService: logData.aiBotByService,
      };
    } catch {
      // ログファイルがない場合は空のまま
    }

    return {
      storeUrl,
      locale,
      t: getTranslations(locale),
      trialInfo,
      aiVisibility,
      settings: settings
        ? {
            siteType: settings.siteType ?? "",
            title: settings.title ?? "",
            roleSummary: settings.roleSummary ?? "",
            sectionsOutline: settings.sectionsOutline ?? "",
            notesForAi: settings.notesForAi ?? "",
            llmsTxtBody: settings.llmsTxtBody ?? "",
            llmsTxtFileUrl: settings.llmsTxtFileUrl ?? "",
            llmsFullTxtFileUrl: settings.llmsFullTxtFileUrl ?? "",
            llmsFullTxtGeneratedAt: settings.llmsFullTxtGeneratedAt?.toISOString() ?? null,
            aiContextBody: settings.aiContextBody ?? "",
            aiContextFileUrl: settings.aiContextFileUrl ?? "",
            aiContextGeneratedAt: settings.aiContextGeneratedAt?.toISOString() ?? null,
            docsAiFiles,
            openaiApiKeySet,
            reportEmail: settings.reportEmail ?? "",
            reportEnabled: settings.reportEnabled ?? false,
          }
        : emptySettings,
      loaderError: null as string | null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ap-llmo] app._index loader error:", err);
    const locale = getLocaleFromRequest(request);
    return {
      storeUrl: "",
      locale,
      t: getTranslations(locale),
      trialInfo: { hasAccess: true, trialEndsAt: "", isSubscribed: false, isTrialActive: false, daysRemaining: 0 },
      aiVisibility: { aiBotTotal: 0, aiBotByService: {} as Record<string, number> },
      settings: emptySettings,
      loaderError: message,
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  if (!shop) {
    return Response.json({ error: "No shop" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;

  const getPromptInput = () => ({
    siteType: (formData.get("siteType") as string) ?? "",
    title: (formData.get("title") as string) ?? "",
    roleSummary: (formData.get("roleSummary") as string) ?? "",
    sectionsOutline: (formData.get("sectionsOutline") as string) ?? "",
    notesForAi: (formData.get("notesForAi") as string) ?? "",
    industry: (formData.get("industry") as string)?.trim() || undefined,
    target: (formData.get("target") as string)?.trim() || undefined,
    productType: (formData.get("productType") as string)?.trim() || undefined,
    docsAiFiles: undefined as { filename: string; fileUrl?: string | null }[] | undefined,
  });

  if (intent === "getPrompt") {
    const count = Math.min(parseInt(String(formData.get("docsAiCount") || "0"), 10) || 0, MAX_DOCS_AI_ROWS);
    const docsAiFiles: { filename: string; fileUrl?: string | null }[] = [];
    for (let i = 0; i < count; i++) {
      const filename = (formData.get(`docsAiFilename_${i}`) as string)?.trim();
      if (!filename) continue;
      const fileUrl = (formData.get(`docsAiFileUrl_${i}`) as string)?.trim() || null;
      docsAiFiles.push({ filename, fileUrl });
    }
    const input = getPromptInput();
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
      const input = getPromptInput();
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
      // openaiApiKey 列がまだない DB 用: その列を参照しない raw upsert（MySQL 想定）
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

    // docs/ai ファイルの URL リダイレクトを設定
    const docsForRedirect = uploadedDocs
      .filter((d) => d.filename && d.fileUrl)
      .map((d) => ({ filename: d.filename, fileUrl: d.fileUrl }));
    if (docsForRedirect.length > 0) {
      setupAllUrlRedirects(admin, { docsAiFiles: docsForRedirect }).catch((e) =>
        console.error("[ap-llmo] setupAllUrlRedirects for docs failed:", e)
      );
    }

    // リダイレクトは埋め込み環境で 404 や表示崩れの原因になるため、JSON を返して fetcher で loader 再検証させる
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
        // openaiApiKey 列がまだない DB 用: raw upsert（MySQL）
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

      // URL リダイレクトを設定（/llms.txt → CDN URL, sitemap-ai.xml も一緒に設定）
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

  // .ai-context を AI で生成する
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
          productCount: storeData.collections.reduce((acc, c) => acc + c.products.length, 0),
          collectionCount: storeData.collections.length,
          vendorCount: new Set(storeData.collections.flatMap((c) => c.products.map((p) => p.vendor).filter(Boolean))).size,
          hasShippingPolicy: !!storeData.shippingPolicy,
          hasRefundPolicy: !!storeData.refundPolicy,
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

  // .ai-context を修正して再生成する
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

  // .ai-context をファイルとして保存する
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

  // 定時処理を手動実行
  if (intent === "runCronJob") {
    try {
      const result = await runDailyJobManually();
      return Response.json({ ok: result.success, message: result.message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] runCronJob error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // レポート設定を保存
  if (intent === "saveReportSettings") {
    try {
      const reportEmail = (formData.get("reportEmail") as string)?.trim() ?? "";
      const reportEnabled = formData.get("reportEnabled") === "true";

      await prisma.llmoSettings.upsert({
        where: { shop },
        create: { shop, reportEmail: reportEmail || null, reportEnabled },
        update: { reportEmail: reportEmail || null, reportEnabled },
      });

      return Response.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] saveReportSettings error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // テストメール送信
  if (intent === "testEmail") {
    try {
      const { sendEmail } = await import("../lib/email.server");
      const testEmail = (formData.get("testEmail") as string)?.trim();
      if (!testEmail) {
        return Response.json({ ok: false, error: "Email address required" }, { status: 400 });
      }
      const locale = getLocaleFromRequest(request);
      const isJa = locale === "ja";
      const result = await sendEmail({
        to: testEmail,
        subject: isJa ? "[AP LLMO] テストメール" : "[AP LLMO] Test Email",
        html: isJa
          ? `
            <h1>テストメール</h1>
            <p>AP LLMO からのメール送信テストです。</p>
            <p>このメールが届いていれば、SMTP 設定は正常です。</p>
            <p>Store: ${shop}</p>
            <p>Time: ${new Date().toISOString()}</p>
          `
          : `
            <h1>Test Email</h1>
            <p>This is a test email from AP LLMO.</p>
            <p>If you received this email, your SMTP settings are working correctly.</p>
            <p>Store: ${shop}</p>
            <p>Time: ${new Date().toISOString()}</p>
          `,
      });
      return Response.json({ ok: result.success, error: result.error });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] testEmail error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

const sectionStyle = {
  marginTop: "1.5rem",
  padding: "1rem 1.25rem",
  background: "#f6f6f7",
  borderRadius: "8px",
  fontSize: "0.9375rem",
  lineHeight: 1.7,
} as const;

const listStyle = { margin: 0, paddingLeft: "1.25rem" } as const;

const inputStyle = {
  display: "block",
  width: "100%",
  maxWidth: "400px",
  marginTop: "0.25rem",
  padding: "0.5rem 0.75rem",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "0.9375rem",
} as const;

const textareaStyle = {
  ...inputStyle,
  maxWidth: "calc(100% - 1.5rem)",
  minHeight: "120px",
  resize: "vertical" as const,
};

const labelStyle = { display: "block", marginTop: "1rem", fontWeight: 600, fontSize: "0.875rem" };

const emptyDocRow = (): DocsAiFileEntry => ({
  filename: "",
  content: "",
  fileId: null,
  fileUrl: null,
});

export default function AppIndex() {
  const data = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const t = data.t;
  const fetcher = useFetcher<{ prompt?: string; body?: string; error?: string; message?: string; ok?: boolean; url?: string }>();
  const isSaving = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "save";
  const prompt = fetcher.data?.prompt;
  const lastIntent = (fetcher.formData as FormData | undefined)?.get("intent");
  const isPromptLoading = fetcher.state !== "idle" && lastIntent === "getPrompt";
  const isAiGenerating = fetcher.state !== "idle" && lastIntent === "generateLlmsTxt";
  const isRefining = fetcher.state !== "idle" && lastIntent === "refineLlmsTxt";
  const isGeneratingFullTxt = fetcher.state !== "idle" && lastIntent === "generateFullTxt";
  const isGeneratingAiContext = fetcher.state !== "idle" && lastIntent === "generateAiContext";
  const isRefiningAiContext = fetcher.state !== "idle" && lastIntent === "refineAiContext";
  const isSavingAiContext = fetcher.state !== "idle" && lastIntent === "saveAiContext";
  const isRunningCronJob = fetcher.state !== "idle" && lastIntent === "runCronJob";
  const isSavingReport = fetcher.state !== "idle" && lastIntent === "saveReportSettings";
  const isSendingTestEmail = fetcher.state !== "idle" && lastIntent === "testEmail";
  const fileResult =
    lastIntent === "saveFile"
      ? (fetcher.data as { ok?: boolean; error?: string; url?: string } | undefined)
      : null;
  const fullTxtResult =
    lastIntent === "generateFullTxt"
      ? (fetcher.data as { ok?: boolean; error?: string; url?: string } | undefined)
      : null;
  const aiContextSaveResult =
    lastIntent === "saveAiContext"
      ? (fetcher.data as { ok?: boolean; error?: string; url?: string } | undefined)
      : null;
  const cronJobResult =
    lastIntent === "runCronJob"
      ? (fetcher.data as { ok?: boolean; error?: string; message?: string } | undefined)
      : null;
  const reportResult =
    lastIntent === "saveReportSettings"
      ? (fetcher.data as { ok?: boolean; error?: string } | undefined)
      : null;
  const testEmailResult =
    lastIntent === "testEmail"
      ? (fetcher.data as { ok?: boolean; error?: string } | undefined)
      : null;

  // Weekly report settings state
  const [reportEmail, setReportEmail] = useState(data.settings.reportEmail);
  const [reportEnabled, setReportEnabled] = useState(data.settings.reportEnabled);
  // 400 などで intent が消えてもエラー本文を表示（generateLlmsTxt は上記ブロックで表示するので除外）
  const anyFetcherError =
    fetcher.state === "idle" &&
    lastIntent !== "generateLlmsTxt" &&
    lastIntent !== "refineLlmsTxt" &&
    fetcher.data &&
    typeof (fetcher.data as { error?: string }).error === "string" &&
    !(fetcher.data as { body?: string }).body &&
    !(fetcher.data as { prompt?: string }).prompt
      ? (fetcher.data as { error: string }).error
      : null;
  const llmsTxtBodyRef = useRef<HTMLTextAreaElement>(null);
  const refinementNoteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.body && llmsTxtBodyRef.current) {
      llmsTxtBodyRef.current.value = fetcher.data.body;
      if (refinementNoteRef.current) refinementNoteRef.current.value = "";
    }
  }, [fetcher.state, fetcher.data?.body]);

  // API Key 未設定などでサーバーがエラーを返したときに alert 表示
  useEffect(() => {
    const intent = (fetcher.formData as FormData | undefined)?.get("intent");
    if (
      fetcher.state === "idle" &&
      intent === "generateLlmsTxt" &&
      fetcher.data?.error === "API_KEY_REQUIRED"
    ) {
      alert(t.aiErrorNoKey);
    }
  }, [fetcher.state, fetcher.formData, fetcher.data?.error, t.aiErrorNoKey]);

  // .ai-context 生成・再生成時に body を更新
  useEffect(() => {
    const intent = (fetcher.formData as FormData | undefined)?.get("intent");
    if (
      fetcher.state === "idle" &&
      (intent === "generateAiContext" || intent === "refineAiContext") &&
      fetcher.data?.body
    ) {
      setAiContextBody(fetcher.data.body);
      if (intent === "refineAiContext") {
        setAiContextRefinementNote("");
      }
    }
    if (
      fetcher.state === "idle" &&
      (intent === "generateAiContext" || intent === "refineAiContext") &&
      fetcher.data?.error === "API_KEY_REQUIRED"
    ) {
      alert(t.aiErrorNoKey);
    }
  }, [fetcher.state, fetcher.formData, fetcher.data?.body, fetcher.data?.error, t.aiErrorNoKey]);

  const initialDocs =
    data.settings.docsAiFiles?.length > 0
      ? data.settings.docsAiFiles
      : [emptyDocRow()];
  const [docsRows, setDocsRows] = useState<DocsAiFileEntry[]>(initialDocs);
  const [useAiRefinementForFull, setUseAiRefinementForFull] = useState(false);
  const [aiContextBody, setAiContextBody] = useState(data.settings.aiContextBody ?? "");
  const [aiContextRefinementNote, setAiContextRefinementNote] = useState("");

  const addDocRow = useCallback(() => {
    setDocsRows((prev) => (prev.length >= MAX_DOCS_AI_ROWS ? prev : [...prev, emptyDocRow()]));
  }, []);
  const removeDocRow = useCallback((index: number) => {
    setDocsRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const copyPrompt = () => {
    if (prompt) {
      navigator.clipboard.writeText(prompt);
      const btn = document.getElementById("copy-prompt-btn");
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = t.copied;
        setTimeout(() => { btn.textContent = prev; }, 1500);
      }
    }
  };

  const docsAiCount = data.settings.docsAiFiles?.length ?? 0;
  const llmsTxtSet = Boolean(data.settings.llmsTxtFileUrl?.trim());
  const loaderError = (data as { loaderError?: string | null }).loaderError;

  const isAnyLoading = isSaving || isPromptLoading || isAiGenerating || isRefining || isGeneratingFullTxt || isGeneratingAiContext || isRefiningAiContext || isSavingAiContext;

  return (
    <div
      className="app-home-grid"
      style={{
        padding: "2rem",
        display: "grid",
        gridTemplateColumns: "1fr minmax(260px, 320px)",
        gap: "2rem",
        alignItems: "start",
        maxWidth: "1200px",
      }}
    >
      <style>{`
        @media (max-width: 900px) { .app-home-grid { grid-template-columns: 1fr !important; } }
        @keyframes ap-llmo-spin { to { transform: rotate(360deg); } }
      `}</style>

      {isAnyLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              width: "3rem",
              height: "3rem",
              border: "4px solid rgba(255, 255, 255, 0.3)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "ap-llmo-spin 0.7s linear infinite",
            }}
            aria-label="Loading"
          />
        </div>
      )}

      <main style={{ minWidth: 0 }}>
      {loaderError && (
        <p style={{ padding: "1rem", marginBottom: "1rem", background: "#fef2f2", color: "#b91c1c", borderRadius: "8px", fontSize: "0.9375rem" }}>
          {t.error}: {loaderError}
        </p>
      )}
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        {t.appTitle}
        <span style={{ marginLeft: "1rem", fontWeight: 400, fontSize: "0.875rem" }}>
          <Link to="access-log" style={{ color: "var(--p-color-text-secondary, #6d7175)" }}>{t.accessLogNav}</Link>
        </span>
      </h1>
      <p style={{ color: "#6d7175", fontSize: "0.9375rem", marginBottom: "0.25rem" }}>
        {t.appDesc}
      </p>
      <p style={{ color: "#888", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        {t.appDescSub}
      </p>

      {/* このアプリの思想 */}
      <section style={{ ...sectionStyle, borderLeft: "4px solid #2c6ecb" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.philosophyTitle}</h2>
          <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.7 }}>
          {(() => {
            const boldPhrase = data.locale === "en" ? "don't let it tell lies" : "嘘をつかせない";
            const parts = t.philosophyBody.split(boldPhrase);
            return (
              <>
                {parts[0]}
                <strong>{boldPhrase}</strong>
                {parts[1] ?? ""}
              </>
            );
          })()}
        </p>
        <p style={{ margin: "0.75rem 0 0 0", fontSize: "0.875rem", color: "#6d7175", lineHeight: 1.6 }}>
          {t.philosophyNote}{" "}
          <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer">{t.andplusLlmsRef}</a>
        </p>
      </section>

      {/* 設定フォーム（思想・プロトコル：あんどぷらす llms.txt 参照） */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.llmsTxtSettings}</h2>
        <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "0.75rem" }}>
          {t.llmsTxtSettingsNote}{" "}
          <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer">{t.andplusLlmsRef}</a>
        </p>

        {/* 各項目を定義する理由（なぜ・なんのために） */}
        <details style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#f9fafb", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
          <summary style={{ fontSize: "0.9375rem", fontWeight: 600, cursor: "pointer" }}>
            {t.fieldPurposeTitle}
          </summary>
          <p style={{ margin: "0.75rem 0 0 0", fontSize: "0.875rem", lineHeight: 1.65, color: "#202223" }}>
            {t.fieldPurposeIntro}
          </p>
          <ul style={{ margin: "0.75rem 0 0 0", paddingLeft: "1.25rem", fontSize: "0.8125rem", lineHeight: 1.7, color: "#4d5156" }}>
            <li><strong>{t.siteType}</strong> — {t.siteTypeWhy}</li>
            <li><strong>{t.titleLabel}</strong> — {t.titleWhy}</li>
            <li><strong>{t.roleSummaryLabel}</strong> — {t.roleSummaryWhy}</li>
            <li><strong>{t.sectionsOutlineLabel}</strong> — {t.sectionsOutlineWhy}</li>
            <li><strong>{t.notesForAiLabel}</strong> — {t.notesForAiWhy}</li>
          </ul>
        </details>

        <Form method="post" id="llmo-form">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="docsAiCount" value={docsRows.length} />

          <label style={labelStyle}>
            {t.siteType}
            <select name="siteType" style={inputStyle} defaultValue={data.settings.siteType}>
              <option value="corporate">{t.siteTypeCorporate}</option>
              <option value="ec">{t.siteTypeEc}</option>
              <option value="corporate_ec">{t.siteTypeCorporateEc}</option>
            </select>
          </label>

          <label style={labelStyle}>
            {t.titleLabel}
            <input
              type="text"
              name="title"
              style={inputStyle}
              defaultValue={data.settings.title}
              placeholder={t.titlePlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.roleSummaryLabel}
            <textarea
              name="roleSummary"
              style={textareaStyle}
              defaultValue={data.settings.roleSummary}
              placeholder={t.roleSummaryPlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.sectionsOutlineLabel}
            <textarea
              name="sectionsOutline"
              style={textareaStyle}
              defaultValue={data.settings.sectionsOutline}
              placeholder={t.sectionsOutlinePlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.notesForAiLabel}
            <textarea
              name="notesForAi"
              style={textareaStyle}
              defaultValue={data.settings.notesForAi}
              placeholder={t.notesForAiPlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.industryLabel}
            <input
              type="text"
              name="industry"
              style={inputStyle}
              placeholder={t.industryPlaceholder}
            />
          </label>
          <label style={labelStyle}>
            {t.targetLabel}
            <input
              type="text"
              name="target"
              style={inputStyle}
              placeholder={t.targetPlaceholder}
            />
          </label>
          <label style={labelStyle}>
            {t.productTypeLabel}
            <input
              type="text"
              name="productType"
              style={inputStyle}
              placeholder={t.productTypePlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.openaiApiKeyLabel}
            <input
              type="password"
              name="openaiApiKey"
              style={inputStyle}
              placeholder={t.openaiApiKeyPlaceholder}
              autoComplete="off"
            />
            {data.settings.openaiApiKeySet && (
              <span style={{ display: "block", fontSize: "0.8125rem", color: "#6d7175", marginTop: "0.25rem" }}>
                {t.openaiApiKeySetNote}
              </span>
            )}
          </label>

          {/* docs/ai 用 md：動的に行追加（最大10） */}
          <section style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #e1e3e5" }}>
            <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.docsAiSectionTitle}</h3>
            <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "0.75rem" }}>{t.docsAiSectionNote}</p>
            {docsRows.map((row, i) => (
              <div key={i} style={{ marginBottom: "1rem", padding: "0.75rem", background: "#fff", borderRadius: "6px", border: "1px solid #e1e3e5" }}>
                <input type="hidden" name={`docsAiFileId_${i}`} value={row.fileId ?? ""} />
                <input type="hidden" name={`docsAiFileUrl_${i}`} value={row.fileUrl ?? ""} />
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <label style={{ ...labelStyle, marginTop: 0, flex: "1 1 auto" }}>
                    {t.docsAiFilename}
                    <input
                      type="text"
                      name={`docsAiFilename_${i}`}
                      style={inputStyle}
                      defaultValue={row.filename}
                      placeholder={t.docsAiFilenamePlaceholder}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeDocRow(i)}
                    style={{ alignSelf: "flex-end", padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer", fontSize: "0.8125rem" }}
                  >
                    {t.removeRow}
                  </button>
                </div>
                <label style={{ ...labelStyle, marginTop: "0.5rem" }}>
                  {t.docsAiContent}
                  <textarea
                    name={`docsAiContent_${i}`}
                    style={{ ...textareaStyle, minHeight: "80px" }}
                    defaultValue={row.content}
                  />
                </label>
                {row.fileUrl && (
                  <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.75rem", color: "#6d7175" }}>
                    URL: <a href={row.fileUrl} target="_blank" rel="noopener noreferrer">{row.fileUrl}</a>
                  </p>
                )}
              </div>
            ))}
            {docsRows.length < MAX_DOCS_AI_ROWS && (
              <button
                type="button"
                onClick={addDocRow}
                style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px dashed #6d7175", background: "#fff", cursor: "pointer", fontSize: "0.875rem", color: "#6d7175" }}
              >
                + {t.addRow}
              </button>
            )}
          </section>

          <label style={labelStyle}>
            {t.llmsTxtBodyLabel}
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>
              {t.llmsTxtBodyHint}
            </p>
            <textarea
              ref={llmsTxtBodyRef}
              name="llmsTxtBody"
              form="llmo-form"
              style={{ ...textareaStyle, minHeight: "200px", marginTop: "0.5rem" }}
              defaultValue={data.settings.llmsTxtBody}
              placeholder={t.llmsTxtBodyPlaceholder}
            />
          </label>

          {fetcher.data?.error && lastIntent === "generateLlmsTxt" && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#b98900" }}>
              {fetcher.data.error === "API_KEY_REQUIRED"
                ? t.aiErrorNoKey
                : fetcher.data.error === "GENERATE_FAILED"
                  ? fetcher.data.message
                    ? `${t.aiErrorFailed} ${fetcher.data.message}`
                    : t.aiErrorFailed
                  : t.error}
            </p>
          )}

          {fetcher.data?.error && lastIntent === "refineLlmsTxt" && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#b98900" }}>
              {fetcher.data.error === "REFINE_BODY_EMPTY"
                ? t.refineErrorBodyEmpty
                : fetcher.data.error === "REFINE_NOTE_EMPTY"
                  ? t.refineErrorNoteEmpty
                  : fetcher.data.error === "API_KEY_REQUIRED"
                    ? t.aiErrorNoKey
                    : fetcher.data.error === "GENERATE_FAILED"
                      ? (fetcher.data as { message?: string }).message
                        ? `${t.aiErrorFailed} ${(fetcher.data as { message: string }).message}`
                        : t.aiErrorFailed
                      : String((fetcher.data as { error?: string }).error ?? t.error)}
            </p>
          )}

          <section style={{ marginTop: "1.25rem", padding: "1rem", background: "#f9fafb", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
            <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.refinementSectionTitle}</h3>
            <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "0.5rem" }}>
              {data.locale === "ja"
                ? "上の llms.txt 本文をベースに、修正希望を書いて「この内容で再生成」を押すと、AI が修正版を生成します。"
                : "Enter what you want to change about the llms.txt body above, then click the button to regenerate."}
            </p>
            <label style={{ ...labelStyle, marginTop: "0.5rem" }}>
              {t.refinementNoteLabel}
              <input
                ref={refinementNoteRef}
                type="text"
                style={{ ...inputStyle, maxWidth: "calc(100% - 1.5rem)" }}
                placeholder={t.refinementNotePlaceholder}
                disabled={isRefining}
              />
            </label>
            <button
              type="button"
              disabled={isRefining}
              onClick={() => {
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "refineLlmsTxt");
                fd.set("refinementNote", refinementNoteRef.current?.value ?? "");
                fetcher.submit(fd, { method: "post" });
              }}
              style={{ marginTop: "0.5rem", padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #6d7175", background: "#fff", cursor: isRefining ? "wait" : "pointer", fontSize: "0.9375rem" }}
            >
              {isRefining ? t.refining : t.refineButton}
            </button>
          </section>

          <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "save");
                fetcher.submit(fd, { method: "post" });
              }}
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #2c6ecb", background: "#2c6ecb", color: "#fff", cursor: isSaving ? "wait" : "pointer", fontSize: "0.9375rem" }}
            >
              {isSaving ? t.saveSettingsLoading : t.saveSettings}
            </button>
            <button
              type="button"
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #6d7175", background: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}
              onClick={() => {
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "getPrompt");
                fetcher.submit(fd, { method: "post" });
              }}
              disabled={isPromptLoading}
            >
              {isPromptLoading ? t.generating : t.generatePrompt}
            </button>
            <button
              type="button"
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}
              onClick={() => {
                if (!data.settings.openaiApiKeySet) {
                  alert(t.aiErrorNoKey);
                  return;
                }
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "generateLlmsTxt");
                fetcher.submit(fd, { method: "post" });
              }}
              disabled={isAiGenerating}
            >
              {isAiGenerating ? t.aiGenerating : t.aiGenerate}
            </button>
            <button
              type="button"
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}
              onClick={() => {
                const body = llmsTxtBodyRef.current?.value?.trim() ?? "";
                if (!body) {
                  alert(t.saveFileBodyEmpty);
                  return;
                }
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "saveFile");
                fetcher.submit(fd, { method: "post" });
              }}
            >
              {t.saveFile}
            </button>
          </div>
        </Form>
      </section>

      {/* プロンプト表示・コピー・AI への渡し方案内 */}
      {prompt != null && (
        <section style={{ ...sectionStyle, marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.generatedPromptTitle}</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, padding: "0.75rem", background: "#fff", border: "1px solid #e1e3e5", borderRadius: "6px", fontSize: "0.8125rem", maxHeight: "300px", overflow: "auto" }}>
            {prompt}
          </pre>
          <button
            id="copy-prompt-btn"
            type="button"
            onClick={copyPrompt}
            style={{ marginTop: "0.5rem", padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid #6d7175", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}
          >
            {t.copy}
          </button>
          <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.6 }}>
            {t.promptToAiGuide}
          </p>
        </section>
      )}

      {fileResult?.ok && <p style={{ marginTop: "1rem", color: "#008060", fontSize: "0.9375rem" }}>{t.fileSaved}</p>}
      {(fileResult && !fileResult.ok ? fileResult.error : anyFetcherError) && (
        <p style={{ marginTop: "1rem", color: "#b98900", fontSize: "0.9375rem" }}>
          {t.error}: {fileResult && !fileResult.ok ? fileResult.error : anyFetcherError}
        </p>
      )}

      {data.settings.llmsTxtFileUrl && (
        <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6d7175" }}>
          {t.llmsTxtUrl}: <a href={data.settings.llmsTxtFileUrl} target="_blank" rel="noopener noreferrer">{data.settings.llmsTxtFileUrl}</a>
        </p>
      )}

      {/* llms.full.txt セクション */}
      <section style={{ ...sectionStyle, marginTop: "2rem", borderLeft: "4px solid #008060" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.llmsFullTxtSectionTitle}</h2>
        <p style={{ fontSize: "0.875rem", color: "#6d7175", marginBottom: "1rem", lineHeight: 1.6 }}>
          {t.llmsFullTxtDesc}
        </p>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9375rem", marginBottom: "1rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={useAiRefinementForFull}
            onChange={(e) => setUseAiRefinementForFull(e.target.checked)}
            disabled={!data.settings.openaiApiKeySet}
            style={{ width: "1rem", height: "1rem" }}
          />
          {t.useAiRefinement}
          {!data.settings.openaiApiKeySet && (
            <span style={{ fontSize: "0.75rem", color: "#6d7175" }}>（API Key 未設定）</span>
          )}
        </label>

        <button
          type="button"
          onClick={() => {
            if (useAiRefinementForFull && !data.settings.openaiApiKeySet) {
              alert(t.aiErrorNoKey);
              return;
            }
            const fd = new FormData();
            fd.set("intent", "generateFullTxt");
            fd.set("useAiRefinement", useAiRefinementForFull ? "true" : "false");
            fetcher.submit(fd, { method: "post" });
          }}
          disabled={isGeneratingFullTxt}
          style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: isGeneratingFullTxt ? "wait" : "pointer", fontSize: "0.9375rem" }}
        >
          {isGeneratingFullTxt ? t.generatingFullTxt : t.generateFullTxt}
        </button>

        {fullTxtResult?.ok && (
          <p style={{ marginTop: "0.75rem", color: "#008060", fontSize: "0.875rem" }}>
            ✓ llms.full.txt を生成しました
          </p>
        )}
        {fullTxtResult && !fullTxtResult.ok && fullTxtResult.error && (
          <p style={{ marginTop: "0.75rem", color: "#b91c1c", fontSize: "0.875rem" }}>
            {t.error}: {fullTxtResult.error}
          </p>
        )}

        {data.settings.llmsFullTxtFileUrl && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#6d7175" }}>
            {t.llmsFullTxtUrl}: <a href={data.settings.llmsFullTxtFileUrl} target="_blank" rel="noopener noreferrer">{data.settings.llmsFullTxtFileUrl}</a>
          </p>
        )}
        {data.settings.llmsFullTxtGeneratedAt && (
          <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "#6d7175" }}>
            {t.llmsFullTxtGeneratedAt}: {new Date(data.settings.llmsFullTxtGeneratedAt).toLocaleString()}
          </p>
        )}
      </section>

      {/* .ai-context セクション（llms.txt と同様の独立セクション） */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.aiContextSectionTitle}</h2>
        <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "1rem" }}>{t.aiContextDesc}</p>

        <label style={labelStyle}>{t.aiContextBodyLabel}</label>
        <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "0.5rem" }}>{t.aiContextBodyHint}</p>
        <textarea
          name="aiContextBody"
          value={aiContextBody}
          onChange={(e) => setAiContextBody(e.target.value)}
          rows={12}
          style={inputStyle}
          placeholder={t.aiContextBodyPlaceholder}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          <button
            type="button"
            onClick={() => {
              if (!data.settings.openaiApiKeySet) {
                alert(t.aiErrorNoKey);
                return;
              }
              fetcher.submit({ intent: "generateAiContext" }, { method: "post" });
            }}
            style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: isGeneratingAiContext ? "wait" : "pointer", fontSize: "0.9375rem", minWidth: 140 }}
            disabled={isAnyLoading}
          >
            {isGeneratingAiContext ? t.generatingAiContext : t.generateAiContext}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!aiContextBody.trim()) {
                alert(t.aiContextBodyEmpty);
                return;
              }
              fetcher.submit({ intent: "saveAiContext", aiContextBody }, { method: "post" });
            }}
            style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #6d7175", background: "#fff", color: "#333", cursor: isSavingAiContext ? "wait" : "pointer", fontSize: "0.9375rem", minWidth: 140 }}
            disabled={isAnyLoading || !aiContextBody.trim()}
          >
            {isSavingAiContext ? t.saveSettingsLoading : t.saveAiContext}
          </button>
        </div>

        {/* 再生成（修正点を指定） */}
        {aiContextBody.trim() && (
          <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #e4e5e7" }}>
            <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.refinementSectionTitle}</h3>
            <label style={labelStyle}>{t.refinementNoteLabel}</label>
            <textarea
              value={aiContextRefinementNote}
              onChange={(e) => setAiContextRefinementNote(e.target.value)}
              rows={3}
              style={inputStyle}
              placeholder={t.refinementNotePlaceholder}
            />
            <button
              type="button"
              onClick={() => {
                if (!aiContextBody.trim()) {
                  alert(t.aiContextBodyEmpty);
                  return;
                }
                if (!aiContextRefinementNote.trim()) {
                  alert(t.refineErrorNoteEmpty);
                  return;
                }
                if (!data.settings.openaiApiKeySet) {
                  alert(t.aiErrorNoKey);
                  return;
                }
                fetcher.submit(
                  { intent: "refineAiContext", aiContextBody, refinementNote: aiContextRefinementNote },
                  { method: "post" }
                );
              }}
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: isRefiningAiContext ? "wait" : "pointer", fontSize: "0.9375rem", marginTop: "0.5rem" }}
              disabled={isAnyLoading}
            >
              {isRefiningAiContext ? t.refining : t.refineAiContext}
            </button>
          </div>
        )}

        {aiContextSaveResult?.ok && (
          <p style={{ marginTop: "0.75rem", color: "#008060", fontSize: "0.875rem" }}>
            ✓ {t.aiContextSaved}
          </p>
        )}
        {aiContextSaveResult && !aiContextSaveResult.ok && aiContextSaveResult.error && (
          <p style={{ marginTop: "0.75rem", color: "#b91c1c", fontSize: "0.875rem" }}>
            {t.error}: {aiContextSaveResult.error}
          </p>
        )}

        {data.settings.aiContextFileUrl && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#6d7175" }}>
            {t.aiContextUrl}: <a href={data.settings.aiContextFileUrl} target="_blank" rel="noopener noreferrer">{data.settings.aiContextFileUrl}</a>
          </p>
        )}
        {data.settings.aiContextGeneratedAt && (
          <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "#6d7175" }}>
            {t.aiContextGeneratedAt}: {new Date(data.settings.aiContextGeneratedAt).toLocaleString()}
          </p>
        )}
      </section>
      </main>

      <aside style={{ position: "sticky", top: "1rem" }}>
        {/* トライアル・課金バナー */}
        {data.trialInfo.isTrialActive && (
          <section style={{ ...sectionStyle, background: "#fef3c7", borderLeft: "3px solid #f59e0b", marginTop: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#92400e", fontSize: "0.875rem" }}>
              {data.locale === "ja"
                ? `🎁 無料トライアル中（残り ${data.trialInfo.daysRemaining} 日）`
                : `🎁 Free trial (${data.trialInfo.daysRemaining} days left)`}
            </p>
            <Link
              to="/app/billing"
              style={{ display: "inline-block", marginTop: "0.5rem", fontSize: "0.8125rem", color: "#92400e", textDecoration: "underline" }}
            >
              {data.locale === "ja" ? "Pro プランを見る" : "View Pro Plan"}
            </Link>
          </section>
        )}
        {!data.trialInfo.hasAccess && !data.trialInfo.isSubscribed && (
          <section style={{ ...sectionStyle, background: "#fee2e2", borderLeft: "3px solid #ef4444", marginTop: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#b91c1c", fontSize: "0.875rem" }}>
              {data.locale === "ja" ? "⚠️ トライアル終了" : "⚠️ Trial ended"}
            </p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#b91c1c" }}>
              {data.locale === "ja"
                ? "一部機能が制限されています。"
                : "Some features are restricted."}
            </p>
            <Link
              to="/app/billing"
              style={{ display: "inline-block", marginTop: "0.5rem", padding: "0.375rem 0.75rem", fontSize: "0.8125rem", color: "#fff", background: "#ef4444", borderRadius: "6px", textDecoration: "none" }}
            >
              {data.locale === "ja" ? "Pro プランにアップグレード" : "Upgrade to Pro"}
            </Link>
          </section>
        )}
        {data.trialInfo.isSubscribed && (
          <section style={{ ...sectionStyle, background: "#dcfce7", borderLeft: "3px solid #22c55e", marginTop: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#166534", fontSize: "0.875rem" }}>
              ✓ {data.locale === "ja" ? "Pro プラン" : "Pro Plan"}
            </p>
          </section>
        )}

        {/* AI Visibility ウィジェット */}
        <section
          style={{
            ...sectionStyle,
            background: data.aiVisibility.aiBotTotal > 0 ? "#e8f5e9" : "#f5f5f5",
            borderLeft: data.aiVisibility.aiBotTotal > 0 ? "4px solid #4caf50" : "4px solid #9e9e9e",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem", color: data.aiVisibility.aiBotTotal > 0 ? "#2e7d32" : "#666" }}>
            {data.aiVisibility.aiBotTotal > 0 ? "🤖 " : ""}{t.aiVisibilityTitle}
          </h2>
          {data.aiVisibility.aiBotTotal > 0 ? (
            <>
              <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", color: "#2e7d32", fontWeight: 600 }}>
                {t.aiVisibilityDesc}
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "2rem", fontWeight: 700, color: "#2e7d32" }}>{data.aiVisibility.aiBotTotal}</span>
                <span style={{ fontSize: "0.875rem", color: "#666" }}>{t.aiVisitsTotal}</span>
              </div>
              {Object.entries(data.aiVisibility.aiBotByService).length > 0 && (
                <div style={{ marginBottom: "0.75rem" }}>
                  {Object.entries(data.aiVisibility.aiBotByService)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([service, count]) => (
                      <div key={service} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "#555", padding: "0.125rem 0" }}>
                        <span>{service}</span>
                        <span style={{ fontWeight: 600 }}>{count}</span>
                      </div>
                    ))}
                </div>
              )}
              <Link
                to="access-log"
                style={{ display: "inline-block", fontSize: "0.8125rem", color: "#2e7d32", textDecoration: "underline" }}
              >
                {t.viewDetails} →
              </Link>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 0.25rem 0", fontSize: "0.875rem", color: "#666" }}>
                {t.noAiVisitsYet}
              </p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#999" }}>
                {t.noAiVisitsHint}
              </p>
            </>
          )}
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.sidebarStatusTitle}</h2>
          <ul style={{ ...listStyle, margin: 0, fontSize: "0.875rem" }}>
            <li>{llmsTxtSet ? t.statusLlmsTxtSet : t.statusLlmsTxtNotSet}</li>
            <li>{t.statusDocsAiCount.replace("{count}", String(docsAiCount))}</li>
          </ul>
        </section>

        {/* Generated Files - URL まとめ */}
        <section style={{ ...sectionStyle, background: "#f0f9ff", borderLeft: "3px solid #3b82f6" }}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.generatedFilesTitle}</h2>
          <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.75rem", color: "#6d7175" }}>{t.generatedFilesDesc}</p>
          <div style={{ fontSize: "0.8125rem", lineHeight: 1.8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>llms.txt</span>
              {data.settings.llmsTxtFileUrl ? (
                <a href={`${data.storeUrl}/llms.txt`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.75rem" }}>
                  /llms.txt ↗
                </a>
              ) : (
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{t.fileNotGenerated}</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>llms.full.txt</span>
              {data.settings.llmsFullTxtFileUrl ? (
                <a href={`${data.storeUrl}/llms.full.txt`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.75rem" }}>
                  /llms.full.txt ↗
                </a>
              ) : (
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{t.fileNotGenerated}</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>.ai-context</span>
              {data.settings.aiContextFileUrl ? (
                <a href={`${data.storeUrl}/.ai-context`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.75rem" }}>
                  /.ai-context ↗
                </a>
              ) : (
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{t.fileNotGenerated}</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>docs/ai</span>
              {docsAiCount > 0 ? (
                <a href={`${data.storeUrl}/docs/ai/README.md`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.75rem" }}>
                  /docs/ai/ ↗
                </a>
              ) : (
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{t.fileNotGenerated}</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>sitemap-ai.xml</span>
              <a href={`${data.storeUrl}/sitemap-ai.xml`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.75rem" }}>
                /sitemap-ai.xml ↗
              </a>
            </div>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.sitemapSectionTitle}</h2>
          <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>{t.sitemapDesc}</p>
          <p style={{ margin: "0 0 0.25rem 0", fontSize: "0.8125rem", fontWeight: 600 }}>{t.sitemapUrl}:</p>
          <code style={{ display: "block", fontSize: "0.75rem", background: "#f1f1f1", padding: "0.5rem", borderRadius: "4px", wordBreak: "break-all", marginBottom: "0.5rem" }}>
            {data.storeUrl}/apps/llmo/sitemap-ai.xml
          </code>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#6d7175" }}>{t.sitemapCopyHint}</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.sidebarRefTitle}</h2>
          <ul style={{ ...listStyle, margin: 0, fontSize: "0.875rem" }}>
            <li>
              <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer">{t.andplusLlmsRef}</a>
            </li>
            <li>
              <a href="https://www.andplus.co.jp/docs/ai/README.md" target="_blank" rel="noopener noreferrer">{t.andplusDocsAiRef}</a>
            </li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.guideReadmeTitle}</h2>
          <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>{t.guideReadmeIntro}</p>
          <ul style={{ ...listStyle, margin: 0, fontSize: "0.8125rem", lineHeight: 1.6 }}>
            <li>{t.guideReadmeWelcome}</li>
            <li>{t.guideReadmePrimary}</li>
            <li>{t.guideReadmeExternal}</li>
            <li>{t.guideReadmeGuidelines}</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.whatThisAppDoes}</h2>
          <ul style={listStyle}>
            <li>
              {t.whatThisAppDoesList1.split(/(<head>)/i).map((part, i) =>
                part.toLowerCase() === "<head>" ? <code key={i}>&lt;head&gt;</code> : part
              )}
            </li>
          </ul>
          <ul style={{ ...listStyle, marginTop: "0.5rem" }}>
            <li><strong>llms.txt</strong> — {t.llmsTxtItem}</li>
            <li><strong>llms.full.txt</strong> — {t.llmsFullTxtItem}</li>
            <li><strong>docs/ai/*.md</strong> — {t.docsAiItem}</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.setupTitle}</h2>
          <ol style={listStyle}>
            <li>{t.setup1}</li>
            <li>{t.setup2}</li>
            <li>{t.setup3}</li>
          </ol>
        </section>

        <section style={{ ...sectionStyle, background: "#f0fdf4", borderLeft: "3px solid #22c55e" }}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {data.locale === "ja" ? "週次レポート" : "Weekly Report"}
          </h2>
          <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>
            {data.locale === "ja"
              ? "AI Bot のアクセス状況をメールで受け取れます。毎週月曜 9:00 (JST) に送信されます。"
              : "Receive AI bot access reports via email. Sent every Monday at 9:00 AM (JST)."}
          </p>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={reportEnabled}
                onChange={(e) => setReportEnabled(e.target.checked)}
                style={{ width: "1rem", height: "1rem" }}
              />
              {data.locale === "ja" ? "週次レポートを受け取る" : "Receive weekly report"}
            </label>
          </div>
          {reportEnabled && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.8125rem", color: "#6d7175" }}>
                {data.locale === "ja" ? "送信先メールアドレス" : "Email address"}
              </label>
              <input
                type="email"
                value={reportEmail}
                onChange={(e) => setReportEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  ...inputStyle,
                  maxWidth: "280px",
                  marginTop: "0.25rem",
                }}
              />
            </div>
          )}
          <button
            type="button"
            disabled={isSavingReport}
            onClick={() => {
              fetcher.submit(
                { intent: "saveReportSettings", reportEmail, reportEnabled: String(reportEnabled) },
                { method: "post" }
              );
            }}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid #22c55e",
              background: isSavingReport ? "#dcfce7" : "#fff",
              color: "#166534",
              cursor: isSavingReport ? "wait" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            {isSavingReport
              ? (data.locale === "ja" ? "保存中..." : "Saving...")
              : (data.locale === "ja" ? "設定を保存" : "Save Settings")}
          </button>
          {reportResult?.ok && (
            <p style={{ marginTop: "0.5rem", color: "#15803d", fontSize: "0.8125rem" }}>
              ✓ {data.locale === "ja" ? "保存しました" : "Saved"}
            </p>
          )}
          {reportResult && !reportResult.ok && (
            <p style={{ marginTop: "0.5rem", color: "#b91c1c", fontSize: "0.8125rem" }}>
              {t.error}: {reportResult.error}
            </p>
          )}
          {reportEnabled && reportEmail && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #d1d5db" }}>
              <button
                type="button"
                disabled={isSendingTestEmail}
                onClick={() => {
                  fetcher.submit(
                    { intent: "testEmail", testEmail: reportEmail },
                    { method: "post" }
                  );
                }}
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #9ca3af",
                  background: isSendingTestEmail ? "#f3f4f6" : "#fff",
                  color: "#374151",
                  cursor: isSendingTestEmail ? "wait" : "pointer",
                  fontSize: "0.8125rem",
                }}
              >
                {isSendingTestEmail
                  ? (data.locale === "ja" ? "送信中..." : "Sending...")
                  : (data.locale === "ja" ? "テストメール送信" : "Send Test Email")}
              </button>
              {testEmailResult?.ok && (
                <p style={{ marginTop: "0.5rem", color: "#15803d", fontSize: "0.8125rem" }}>
                  ✓ {data.locale === "ja" ? "送信しました" : "Sent"}
                </p>
              )}
              {testEmailResult && !testEmailResult.ok && (
                <p style={{ marginTop: "0.5rem", color: "#b91c1c", fontSize: "0.8125rem" }}>
                  {t.error}: {testEmailResult.error}
                </p>
              )}
            </div>
          )}
        </section>

        <section style={{ ...sectionStyle, background: "#fef9e7", borderLeft: "3px solid #f59e0b" }}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {data.locale === "ja" ? "開発者向け" : "Developer"}
          </h2>
          <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>
            {data.locale === "ja"
              ? "定時処理（llms.full.txt 再生成 + ログローテーション）を手動で実行します。"
              : "Manually run the daily job (regenerate llms.full.txt + log rotation)."}
          </p>
          <button
            type="button"
            disabled={isRunningCronJob}
            onClick={() => {
              const confirmed = window.confirm(
                data.locale === "ja"
                  ? "定時処理を今すぐ実行しますか？\n\n全ストアの llms.full.txt が再生成されます。"
                  : "Run the daily job now?\n\nThis will regenerate llms.full.txt for all stores."
              );
              if (!confirmed) return;
              fetcher.submit({ intent: "runCronJob" }, { method: "post" });
            }}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid #f59e0b",
              background: isRunningCronJob ? "#fef3c7" : "#fff",
              color: "#92400e",
              cursor: isRunningCronJob ? "wait" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            {isRunningCronJob
              ? (data.locale === "ja" ? "実行中..." : "Running...")
              : (data.locale === "ja" ? "定時処理を実行" : "Run Daily Job")}
          </button>
          {cronJobResult?.ok && (
            <p style={{ marginTop: "0.5rem", color: "#15803d", fontSize: "0.8125rem" }}>
              ✓ {data.locale === "ja" ? "完了しました" : "Completed"}
            </p>
          )}
          {cronJobResult && !cronJobResult.ok && (
            <p style={{ marginTop: "0.5rem", color: "#b91c1c", fontSize: "0.8125rem" }}>
              {t.error}: {cronJobResult.error || cronJobResult.message}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

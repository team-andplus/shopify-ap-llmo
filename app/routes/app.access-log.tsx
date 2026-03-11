import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getLocaleFromRequest, getTranslations } from "../lib/i18n";
import { readAndAggregateLlmoAccessLog, AI_BOT_PATTERNS } from "../lib/llmo-access-log.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const locale = getLocaleFromRequest(request);
  const aggregates = await readAndAggregateLlmoAccessLog(shop);
  const aiBotPatterns = AI_BOT_PATTERNS.map((b) => ({ name: b.name, service: b.service }));
  return { aggregates, locale, t: getTranslations(locale), aiBotPatterns };
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "40rem",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
  marginBottom: "1.5rem",
};
const thTdStyle: React.CSSProperties = {
  border: "1px solid var(--p-color-border-secondary, #e1e3e5)",
  padding: "0.5rem 0.75rem",
  textAlign: "left",
};
const thStyle: React.CSSProperties = { ...thTdStyle, backgroundColor: "var(--p-color-bg-surface-secondary, #f6f6f7)" };

function sortByCount(entries: [string, number][]): [string, number][] {
  return [...entries].sort((a, b) => b[1] - a[1]);
}

export default function AccessLogPage() {
  const { aggregates, t, aiBotPatterns } = useLoaderData<typeof loader>();
  const { total, byShop, byPath, byDate, recent, aiBotTotal, aiBotByService, aiBotByBot, aiBotRecent } = aggregates;

  return (
    <div style={{ padding: "1.5rem 1rem", maxWidth: "56rem" }}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link to=".." style={{ color: "var(--p-color-text-secondary, #6d7175)", fontSize: "0.875rem" }}>
          ← {t.appTitle}
        </Link>
      </p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{t.accessLogTitle}</h1>
      <p style={{ color: "#6d7175", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>{t.accessLogDesc}</p>

      {/* AI ボットセクション（目立つように先頭に配置） */}
      <div
        style={{
          backgroundColor: aiBotTotal > 0 ? "#e8f5e9" : "#f5f5f5",
          border: aiBotTotal > 0 ? "2px solid #4caf50" : "1px solid #e0e0e0",
          borderRadius: "8px",
          padding: "1rem 1.25rem",
          marginBottom: "2rem",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: aiBotTotal > 0 ? "#2e7d32" : "#666" }}>
          {aiBotTotal > 0 ? `🤖 ${t.aiBotHighlight}` : "🤖 " + t.aiBotAccessTitle}
        </h2>
        <p style={{ color: "#666", fontSize: "0.875rem", marginBottom: "1rem" }}>{t.aiBotAccessDesc}</p>

        {aiBotTotal === 0 ? (
          <>
            <p style={{ color: "#888", fontSize: "0.875rem", marginBottom: "1rem" }}>{t.aiBotNoData}</p>
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", color: "#666", fontSize: "0.875rem" }}>
                {t.aiBotDetectionList}
              </summary>
              <table style={{ ...tableStyle, maxWidth: "30rem", marginTop: "0.5rem" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t.aiBotName}</th>
                    <th style={thStyle}>{t.aiBotService}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiBotPatterns.map((bot) => (
                    <tr key={bot.name}>
                      <td style={thTdStyle}>{bot.name}</td>
                      <td style={thTdStyle}>{bot.service}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <>
            <p style={{ fontSize: "1.125rem", marginBottom: "1rem", fontWeight: "bold", color: "#2e7d32" }}>
              {t.aiBotTotalRequests}: {aiBotTotal}
            </p>

            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <div>
                <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>{t.aiBotByService}</h3>
                <table style={{ ...tableStyle, maxWidth: "20rem" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t.aiBotService}</th>
                      <th style={thStyle}>{t.accessLogCount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByCount(Object.entries(aiBotByService)).map(([service, count]) => (
                      <tr key={service}>
                        <td style={thTdStyle}>{service}</td>
                        <td style={thTdStyle}>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>{t.aiBotByBot}</h3>
                <table style={{ ...tableStyle, maxWidth: "20rem" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t.aiBotName}</th>
                      <th style={thStyle}>{t.accessLogCount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByCount(Object.entries(aiBotByBot)).map(([bot, count]) => (
                      <tr key={bot}>
                        <td style={thTdStyle}>{bot}</td>
                        <td style={thTdStyle}>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>{t.aiBotRecentAccess}</h3>
            <table style={{ ...tableStyle, maxWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t.accessLogDate}</th>
                  <th style={thStyle}>{t.aiBotService}</th>
                  <th style={thStyle}>{t.aiBotName}</th>
                  <th style={thStyle}>{t.accessLogPath}</th>
                  <th style={thStyle}>{t.accessLogIp}</th>
                </tr>
              </thead>
              <tbody>
                {aiBotRecent.slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    <td style={thTdStyle}>{row.t}</td>
                    <td style={thTdStyle}>{row.botService}</td>
                    <td style={thTdStyle}>{row.botName}</td>
                    <td style={thTdStyle}>{row.path}</td>
                    <td style={thTdStyle}>{row.ip || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {total === 0 ? (
        <p style={{ color: "#6d7175" }}>{t.accessLogNoData}</p>
      ) : (
        <>
          <p style={{ fontSize: "1rem", marginBottom: "1rem" }}>
            <strong>{t.totalRequests}:</strong> {total}
          </p>

          <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>{t.byShop}</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t.accessLogShop}</th>
                <th style={thStyle}>{t.accessLogCount}</th>
              </tr>
            </thead>
            <tbody>
              {sortByCount(Object.entries(byShop)).map(([shop, count]) => (
                <tr key={shop}>
                  <td style={thTdStyle}>{shop || "(空)"}</td>
                  <td style={thTdStyle}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>{t.byPath}</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t.accessLogPath}</th>
                <th style={thStyle}>{t.accessLogCount}</th>
              </tr>
            </thead>
            <tbody>
              {sortByCount(Object.entries(byPath)).map(([path, count]) => (
                <tr key={path}>
                  <td style={thTdStyle}>{path || "(空)"}</td>
                  <td style={thTdStyle}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>{t.byDate}</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t.accessLogDate}</th>
                <th style={thStyle}>{t.accessLogCount}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byDate)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([day, count]) => (
                  <tr key={day}>
                    <td style={thTdStyle}>{day}</td>
                    <td style={thTdStyle}>{count}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>{t.recentAccess}</h2>
          <table style={{ ...tableStyle, maxWidth: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t.accessLogDate}</th>
                <th style={thStyle}>{t.accessLogShop}</th>
                <th style={thStyle}>{t.accessLogPath}</th>
                <th style={thStyle}>{t.accessLogIp}</th>
                <th style={thStyle}>{t.accessLogUserAgent}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row, i) => (
                <tr key={i} style={row.aiBot ? { backgroundColor: "#e8f5e9" } : undefined}>
                  <td style={thTdStyle}>{row.t}</td>
                  <td style={thTdStyle}>{row.shop}</td>
                  <td style={thTdStyle}>{row.path}</td>
                  <td style={thTdStyle}>{row.ip || "—"}</td>
                  <td style={{ ...thTdStyle, maxWidth: "16rem", overflow: "hidden", textOverflow: "ellipsis" }} title={row.ua}>
                    {row.aiBot ? (
                      <span style={{ color: "#2e7d32", fontWeight: "bold" }}>🤖 {row.aiBot.name}</span>
                    ) : (
                      row.ua || "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

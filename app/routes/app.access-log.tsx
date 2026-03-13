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

function sortByCount(entries: [string, number][]): [string, number][] {
  return [...entries].sort((a, b) => b[1] - a[1]);
}

const sectionStyle = {
  marginTop: "1.5rem",
  padding: "1rem 1.25rem",
  background: "#f6f6f7",
  borderRadius: "8px",
  fontSize: "0.9375rem",
  lineHeight: 1.6,
} as const;

export default function AccessLogPage() {
  const { aggregates, locale, t, aiBotPatterns } = useLoaderData<typeof loader>();
  const { total, byShop, byPath, byDate, recent, aiBotTotal, aiBotByService, aiBotByBot, aiBotRecent } = aggregates;

  return (
    <div className="access-log-page" style={{ padding: "2rem", maxWidth: "960px", minWidth: 0 }}>
      <style>{`
        .access-log-page table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
          table-layout: fixed;
        }
        .access-log-page table.cols-auto { table-layout: auto; }
        .access-log-page th,
        .access-log-page td {
          border: 1px solid #e1e3e5;
          padding: 0.5rem 0.75rem;
          text-align: left;
          vertical-align: top;
        }
        .access-log-page th {
          background: #f6f6f7;
          font-weight: 600;
        }
        .access-log-page td.path-cell,
        .access-log-page td.ua-cell {
          word-break: break-all;
          overflow-wrap: break-word;
          max-width: 16rem;
        }
        .access-log-page .section-title { font-size: 1.0625rem; font-weight: 700; margin-bottom: 0.75rem; }
        .access-log-page .mini-table-wrap { min-width: 0; }
        .access-log-page .ua-line { font-size: 0.8125rem; color: #6d7175; background: #f9fafb; padding: 0.25rem 0.75rem !important; word-break: break-all; }
        @media (max-width: 640px) {
          .access-log-page .grid-2x2 { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <p style={{ marginBottom: "1rem" }}>
        <Link to="/app" style={{ color: "#2c6ecb", textDecoration: "underline", fontSize: "0.9375rem" }}>
          ← {locale === "ja" ? "アプリに戻る" : "Back to app"}
        </Link>
      </p>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>{t.accessLogTitle}</h1>
      <p style={{ color: "#6d7175", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>{t.accessLogDesc}</p>

      {/* AI Visibility サマリー（ホームと同じトーン） */}
      <section
        style={{
          ...sectionStyle,
          marginTop: 0,
          background: aiBotTotal > 0 ? "#e8f5e9" : "#f5f5f5",
          borderLeft: aiBotTotal > 0 ? "4px solid #4caf50" : "4px solid #9e9e9e",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem", color: aiBotTotal > 0 ? "#2e7d32" : "#666" }}>
          {aiBotTotal > 0 ? "🤖 " : ""}{t.aiVisibilityTitle}
        </h2>
        {aiBotTotal > 0 ? (
          <>
            <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", color: "#2e7d32" }}>{t.aiVisibilityDesc}</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "2rem", fontWeight: 700, color: "#2e7d32" }}>{aiBotTotal}</span>
              <span style={{ fontSize: "0.875rem", color: "#666" }}>{t.aiVisitsTotal}</span>
            </div>
            {Object.entries(aiBotByService).length > 0 && (
              <div style={{ marginBottom: "0" }}>
                {sortByCount(Object.entries(aiBotByService))
                  .slice(0, 5)
                  .map(([service, count]) => (
                    <div
                      key={service}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.8125rem",
                        color: "#555",
                        padding: "0.25rem 0",
                      }}
                    >
                      <span>{service}</span>
                      <span style={{ fontWeight: 600 }}>{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 0.25rem 0", fontSize: "0.875rem", color: "#666" }}>{t.noAiVisitsYet}</p>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#999" }}>{t.noAiVisitsHint}</p>
          </>
        )}
      </section>

      {/* AI ボット詳細（データあり時） */}
      {aiBotTotal > 0 && (
        <section style={{ ...sectionStyle, background: "#fff", border: "1px solid #e1e3e5" }}>
          <h2 className="section-title">{t.aiBotAccessTitle}</h2>
          <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "1rem" }}>{t.aiBotAccessDesc}</p>

          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.aiBotByService}</h3>
            <table style={{ maxWidth: "20rem" }}>
              <thead>
                <tr>
                  <th>{t.aiBotService}</th>
                  <th style={{ width: "4.5rem" }}>{t.accessLogCount}</th>
                </tr>
              </thead>
              <tbody>
                {sortByCount(Object.entries(aiBotByService)).map(([service, count]) => (
                  <tr key={service}>
                    <td>{service}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.aiBotRecentAccess}</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="cols-auto">
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>{t.accessLogDate}</th>
                  <th>{t.aiBotService}</th>
                  <th>{t.aiBotName}</th>
                  <th className="path-cell">{t.accessLogPath}</th>
                  <th>{t.accessLogIp}</th>
                </tr>
              </thead>
              <tbody>
                {aiBotRecent.slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{row.t}</td>
                    <td>{row.botService}</td>
                    <td>{row.botName}</td>
                    <td className="path-cell">{row.path}</td>
                    <td>{row.ip || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* AI ボット未検出時: 検出対象一覧 */}
      {aiBotTotal === 0 && (
        <section style={sectionStyle}>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.9375rem", fontWeight: 600 }}>{t.aiBotDetectionList}</summary>
            <table style={{ marginTop: "0.75rem" }}>
              <thead>
                <tr>
                  <th>{t.aiBotName}</th>
                  <th>{t.aiBotService}</th>
                </tr>
              </thead>
              <tbody>
                {aiBotPatterns.map((bot) => (
                  <tr key={bot.name}>
                    <td>{bot.name}</td>
                    <td>{bot.service}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}

      {/* 全アクセス集計 */}
      <section style={{ ...sectionStyle, background: total > 0 ? "#f0f4fa" : "#f6f6f7", borderLeft: "4px solid #2c6ecb" }}>
        <h2 className="section-title">{t.totalRequests}</h2>
        {total === 0 ? (
          <p style={{ color: "#6d7175", margin: 0 }}>{t.accessLogNoData}</p>
        ) : (
          <>
            <p style={{ fontSize: "1rem", marginBottom: "1rem" }}>
              <strong>{t.totalRequests}:</strong> {total}
            </p>

            {/* ストア別・パス別・日付別・Bot別を 2x2 で並べる */}
            <div
              className="grid-2x2"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
                marginBottom: "1.5rem",
              }}
            >
              <div className="mini-table-wrap">
                <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.byShop}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>{t.accessLogShop}</th>
                      <th style={{ width: "4.5rem" }}>{t.accessLogCount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByCount(Object.entries(byShop)).map(([s, count]) => (
                      <tr key={s}>
                        <td>{s || "(空)"}</td>
                        <td>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mini-table-wrap">
                <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.byPath}</h3>
                <table>
                  <thead>
                    <tr>
                      <th className="path-cell">{t.accessLogPath}</th>
                      <th style={{ width: "4.5rem" }}>{t.accessLogCount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByCount(Object.entries(byPath)).map(([path, count]) => (
                      <tr key={path}>
                        <td className="path-cell">{path || "(空)"}</td>
                        <td>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mini-table-wrap">
                <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.byDate}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>{t.accessLogDate}</th>
                      <th style={{ width: "4.5rem" }}>{t.accessLogCount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(byDate)
                      .sort((a, b) => b[0].localeCompare(a[0]))
                      .map(([day, count]) => (
                        <tr key={day}>
                          <td>{day}</td>
                          <td>{count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="mini-table-wrap">
                <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.aiBotByBot}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>{t.aiBotName}</th>
                      <th style={{ width: "4.5rem" }}>{t.accessLogCount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByCount(Object.entries(aiBotByBot)).map(([bot, count]) => (
                      <tr key={bot}>
                        <td>{bot}</td>
                        <td>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.recentAccess}</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="cols-auto">
                <thead>
                  <tr>
                    <th style={{ whiteSpace: "nowrap" }}>{t.accessLogDate}</th>
                    <th>{t.accessLogShop}</th>
                    <th className="path-cell">{t.accessLogPath}</th>
                    <th>{t.accessLogIp}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.flatMap((row, i) => [
                    <tr key={`${i}-main`} style={row.aiBot ? { backgroundColor: "#e8f5e9" } : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>{row.t}</td>
                      <td>{row.shop}</td>
                      <td className="path-cell">{row.path}</td>
                      <td>{row.ip || "—"}</td>
                    </tr>,
                    <tr key={`${i}-ua`} style={row.aiBot ? { backgroundColor: "#e8f5e9" } : undefined}>
                      <td colSpan={4} className="ua-line">
                        {row.aiBot ? (
                          <span style={{ color: "#2e7d32", fontWeight: 600 }}>🤖 {row.aiBot.name}</span>
                        ) : (
                          row.ua || "—"
                        )}
                      </td>
                    </tr>,
                  ])}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

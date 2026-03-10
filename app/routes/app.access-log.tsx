import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getLocaleFromRequest, getTranslations } from "../lib/i18n";
import { readAndAggregateLlmoAccessLog } from "../lib/llmo-access-log.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const locale = getLocaleFromRequest(request);
  const aggregates = await readAndAggregateLlmoAccessLog();
  return { aggregates, locale, t: getTranslations(locale) };
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
  const { aggregates, t } = useLoaderData<typeof loader>();
  const { total, byShop, byPath, byDate, recent } = aggregates;

  return (
    <div style={{ padding: "1.5rem 1rem", maxWidth: "56rem" }}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link to=".." style={{ color: "var(--p-color-text-secondary, #6d7175)", fontSize: "0.875rem" }}>
          ← {t.appTitle}
        </Link>
      </p>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{t.accessLogTitle}</h1>
      <p style={{ color: "#6d7175", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>{t.accessLogDesc}</p>

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
                <th style={thStyle}>{t.accessLogUserAgent}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row, i) => (
                <tr key={i}>
                  <td style={thTdStyle}>{row.t}</td>
                  <td style={thTdStyle}>{row.shop}</td>
                  <td style={thTdStyle}>{row.path}</td>
                  <td style={{ ...thTdStyle, maxWidth: "16rem", overflow: "hidden", textOverflow: "ellipsis" }} title={row.ua}>
                    {row.ua || "—"}
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

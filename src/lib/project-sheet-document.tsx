import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProjectSheet } from "@/lib/project-sheet";

// Same palette as contract-document.tsx and audit-report.tsx, so a project
// sheet, a contract and a walk report look like they came from one company.
const NAVY = "#1b355d";
const MARINER = "#1457a5";
const SLATE = "#4A5568";
const LIGHT = "#E8EDF2";
const HAIR = "#DCE3EA";
const ALERT = "#b23b3b";
const GOLD = "#8a6d1f";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 52, paddingHorizontal: 46, fontSize: 9, color: SLATE },

  headerBand: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottom: `2 solid ${NAVY}`,
    paddingBottom: 10,
    marginBottom: 14,
  },
  wordmark: { fontSize: 8, letterSpacing: 3, color: MARINER, textTransform: "lowercase" },
  title: { fontSize: 18, color: NAVY, marginTop: 3 },
  subtitle: { fontSize: 9.5, color: SLATE, marginTop: 3 },
  headMeta: { fontSize: 8, color: SLATE, textAlign: "right", lineHeight: 1.6 },

  kpiRow: { flexDirection: "row", border: `1 solid ${HAIR}`, marginBottom: 4 },
  kpi: { flex: 1, padding: 8, borderRight: `1 solid ${HAIR}` },
  kpiLast: { flex: 1, padding: 8 },
  kpiLabel: { fontSize: 6.5, letterSpacing: 1.2, color: SLATE, textTransform: "uppercase" },
  kpiValue: { fontSize: 13, color: NAVY, marginTop: 3 },
  kpiValueAlert: { fontSize: 13, color: ALERT, marginTop: 3 },
  kpiNote: { fontSize: 7, color: SLATE, marginTop: 2 },

  section: {
    fontSize: 7.5,
    letterSpacing: 1.6,
    color: SLATE,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 5,
    paddingBottom: 3,
    borderBottom: `1 solid ${HAIR}`,
  },

  th: { flexDirection: "row", borderBottom: `1 solid ${HAIR}`, paddingBottom: 3, marginBottom: 2 },
  thText: { fontSize: 6.5, letterSpacing: 1.1, color: SLATE, textTransform: "uppercase" },
  tr: { flexDirection: "row", paddingVertical: 4, borderBottom: `0.5 solid ${LIGHT}` },
  totalRow: { flexDirection: "row", paddingVertical: 5, backgroundColor: LIGHT, marginTop: 1 },

  cItem: { flex: 1, paddingRight: 8 },
  cCat: { width: 96, paddingRight: 6 },
  cVendor: { width: 74, paddingRight: 6 },
  cNum: { width: 58, textAlign: "right" },

  item: { fontSize: 9, color: NAVY },
  desc: { fontSize: 7.5, color: SLATE, marginTop: 2, lineHeight: 1.4 },
  spec: { fontSize: 7, color: SLATE, marginTop: 1.5 },
  cell: { fontSize: 8.5 },
  num: { fontSize: 8.5, textAlign: "right" },
  numStrong: { fontSize: 9, color: NAVY, textAlign: "right" },
  faint: { fontSize: 8, color: "#9AA6B4", textAlign: "right" },
  gold: { fontSize: 7, color: GOLD, textAlign: "right", marginTop: 1 },

  empty: { fontSize: 8.5, color: SLATE, paddingVertical: 6 },

  footer: {
    position: "absolute",
    bottom: 28,
    left: 46,
    right: 46,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: `1 solid ${HAIR}`,
    paddingTop: 6,
    fontSize: 7,
    color: "#9AA6B4",
  },
});

export function ProjectSheetDocument({ data }: { data: ProjectSheet }) {
  const overBudget = data.approvedBudget > 0 && data.budgeted > data.approvedBudget;

  return (
    <Document title={`${data.projectName} — project sheet`}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.wordmark}>westcreek</Text>
            <Text style={styles.title}>{data.projectName}</Text>
            <Text style={styles.subtitle}>
              {data.propertyName}
              {data.unitNumber ? ` · Unit ${data.unitNumber}` : ""}
            </Text>
          </View>
          <View>
            <Text style={styles.headMeta}>{data.phase}</Text>
            <Text style={styles.headMeta}>
              {data.scopeConfirmedAt ? `Scope confirmed ${data.scopeConfirmedAt}` : "Scope not confirmed"}
            </Text>
            <Text style={styles.headMeta}>Generated {data.generatedAt}</Text>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Approved budget</Text>
            <Text style={styles.kpiValue}>
              {data.approvedBudget > 0 ? usd(data.approvedBudget) : "Not set"}
            </Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Scope budgeted</Text>
            <Text style={overBudget ? styles.kpiValueAlert : styles.kpiValue}>
              {usd(data.budgeted)}
            </Text>
            {overBudget && (
              <Text style={styles.kpiNote}>
                {usd(data.budgeted - data.approvedBudget)} over approved
              </Text>
            )}
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Committed</Text>
            <Text style={styles.kpiValue}>{data.committed > 0 ? usd(data.committed) : "—"}</Text>
          </View>
          <View style={styles.kpiLast}>
            <Text style={styles.kpiLabel}>Actual posted</Text>
            <Text style={styles.kpiValue}>{usd(data.actual)}</Text>
          </View>
        </View>

        {/* ---------------------------------------------------------- scope */}
        <Text style={styles.section}>
          Scope — {data.lines.length} item{data.lines.length === 1 ? "" : "s"}
        </Text>

        {data.lines.length === 0 ? (
          <Text style={styles.empty}>No scope items yet.</Text>
        ) : (
          <>
            <View style={styles.th}>
              <Text style={[styles.thText, styles.cItem]}>Item</Text>
              <Text style={[styles.thText, styles.cCat]}>Budget category</Text>
              <Text style={[styles.thText, styles.cVendor]}>Vendor</Text>
              <Text style={[styles.thText, styles.cNum]}>Budgeted</Text>
              <Text style={[styles.thText, styles.cNum]}>Committed</Text>
              <Text style={[styles.thText, styles.cNum]}>Actual</Text>
            </View>

            {data.lines.map((l, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <View style={styles.cItem}>
                  <Text style={styles.item}>{l.item || "Untitled item"}</Text>
                  {l.description && <Text style={styles.desc}>{l.description}</Text>}
                  {l.specs.length > 0 && (
                    <Text style={styles.spec}>Specs — {l.specs.join(" · ")}</Text>
                  )}
                </View>
                <Text style={[styles.cell, styles.cCat]}>{l.category ?? "Not categorised"}</Text>
                <Text style={[styles.cell, styles.cVendor]}>
                  {l.vendorName ?? "Awaiting award"}
                </Text>
                <Text style={[l.budgeted != null ? styles.numStrong : styles.faint, styles.cNum]}>
                  {l.budgeted != null ? usd(l.budgeted) : "Not priced"}
                </Text>
                <Text style={[l.committed ? styles.num : styles.faint, styles.cNum]}>
                  {l.committed ? usd(l.committed) : "—"}
                </Text>
                <View style={styles.cNum}>
                  <Text style={l.actual ? styles.num : styles.faint}>
                    {l.actual != null ? usd(l.actual) : "—"}
                  </Text>
                  {/* Posted spend is a category fact. Where several lines share
                      one, the figure is the category's and says so rather than
                      implying a split nobody posted. */}
                  {l.actualIsCategory && !!l.actual && (
                    <Text style={styles.gold}>category total</Text>
                  )}
                </View>
              </View>
            ))}

            <View style={styles.totalRow}>
              <Text style={[styles.item, styles.cItem]}>Total</Text>
              <Text style={styles.cCat} />
              <Text style={styles.cVendor} />
              <Text style={[styles.numStrong, styles.cNum]}>{usd(data.budgeted)}</Text>
              <Text style={[styles.numStrong, styles.cNum]}>
                {data.committed > 0 ? usd(data.committed) : "—"}
              </Text>
              <Text style={[styles.numStrong, styles.cNum]}>{usd(data.actual)}</Text>
            </View>
          </>
        )}

        {/* --------------------------------------------------------- awards */}
        <Text style={styles.section}>Awards and contracts</Text>
        {data.awards.length === 0 ? (
          <Text style={styles.empty}>Nothing awarded yet.</Text>
        ) : (
          <>
            <View style={styles.th}>
              <Text style={[styles.thText, styles.cVendor]}>Vendor</Text>
              <Text style={[styles.thText, styles.cItem]}>Covers</Text>
              <Text style={[styles.thText, styles.cNum]}>Amount</Text>
              <Text style={[styles.thText, styles.cCat]}>Contract</Text>
            </View>
            {data.awards.map((a, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={[styles.cell, styles.cVendor]}>{a.vendorName}</Text>
                <Text style={[styles.cell, styles.cItem]}>{a.covers}</Text>
                <Text style={[styles.numStrong, styles.cNum]}>{usd(a.amount)}</Text>
                <Text style={[styles.cell, styles.cCat]}>{a.contract}</Text>
              </View>
            ))}
          </>
        )}

        {/* --------------------------------------------------------- phases */}
        <Text style={styles.section}>Phases</Text>
        <View style={styles.th}>
          <Text style={[styles.thText, styles.cItem]}>Phase</Text>
          <Text style={[styles.thText, styles.cCat]}>Planned</Text>
          <Text style={[styles.thText, styles.cCat]}>Actual</Text>
          <Text style={[styles.thText, styles.cNum]}>Variance</Text>
        </View>
        {data.phases.map((p, i) => (
          <View key={i} style={styles.tr} wrap={false}>
            <Text style={[styles.cell, styles.cItem]}>{p.label}</Text>
            <Text style={[styles.cell, styles.cCat]}>{p.planned ?? "—"}</Text>
            <Text style={[styles.cell, styles.cCat]}>{p.actual ?? "—"}</Text>
            <Text
              style={[
                p.varianceDays != null && p.varianceDays > 0 ? styles.gold : styles.num,
                styles.cNum,
              ]}
            >
              {p.varianceDays == null ? "—" : `${p.varianceDays > 0 ? "+" : ""}${p.varianceDays}d`}
            </Text>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>
            {data.projectName} · {data.propertyName}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// Westcreek Deep Navy palette (matches the app chrome).
const NAVY = "#1b355d";
const MARINER = "#1457a5";
const SLATE = "#4A5568";
const LIGHT = "#E8EDF2";

export type ReportPhoto = {
  url: string; // directly-fetchable (signed) URL
  caption: string | null;
  stamp: string | null;
};

export type ReportFinding = {
  index: number;
  title: string;
  description: string | null;
  location: string | null;
  severity: string;
  status: string;
  assignee: string | null;
  dueDate: string | null;
  photos: ReportPhoto[];
};

export type ReportData = {
  propertyName: string;
  auditTitle: string;
  auditDate: string;
  auditorName: string | null;
  status: string;
  notes: string | null;
  findings: ReportFinding[];
};

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, color: SLATE },
  wordmark: { fontSize: 9, letterSpacing: 3, color: MARINER, textTransform: "lowercase" },
  headerBand: { marginBottom: 18, borderBottom: `2 solid ${NAVY}`, paddingBottom: 12 },
  reportLabel: { fontSize: 8, letterSpacing: 2, color: SLATE, textTransform: "uppercase" },
  propertyName: { fontSize: 20, color: NAVY, marginTop: 2 },
  auditTitle: { fontSize: 13, color: MARINER, marginTop: 2 },
  meta: { fontSize: 9, color: SLATE, marginTop: 4 },
  notes: { fontSize: 9, color: SLATE, marginTop: 6, fontStyle: "italic" },
  finding: { marginBottom: 16, paddingBottom: 12, borderBottom: `1 solid ${LIGHT}` },
  findingHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  findingTitle: { fontSize: 12, color: NAVY },
  badge: { fontSize: 7, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3, color: "#fff" },
  findingMeta: { fontSize: 8, color: SLATE, marginBottom: 4 },
  desc: { fontSize: 10, color: SLATE, marginBottom: 6 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoBox: { width: 232, marginBottom: 8 },
  photo: { width: 232, height: 174, objectFit: "contain", backgroundColor: LIGHT, borderRadius: 3 },
  caption: { fontSize: 8, color: SLATE, marginTop: 2 },
  stamp: { fontSize: 7, color: "#8a94a3", marginTop: 1 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#8a94a3",
    borderTop: `1 solid ${LIGHT}`,
    paddingTop: 6,
  },
  empty: { fontSize: 10, color: SLATE, marginTop: 20 },
});

const SEVERITY_COLOR: Record<string, string> = {
  low: "#64748b",
  medium: "#b45309",
  high: "#b91c1c",
};

export function AuditReport({ data }: { data: ReportData }) {
  return (
    <Document title={`${data.auditTitle} — ${data.propertyName}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerBand} fixed={false}>
          <Text style={styles.wordmark}>westcreek</Text>
          <Text style={styles.reportLabel}>Site Audit Report</Text>
          <Text style={styles.propertyName}>{data.propertyName}</Text>
          <Text style={styles.auditTitle}>{data.auditTitle}</Text>
          <Text style={styles.meta}>
            {data.auditDate}
            {data.auditorName ? ` · ${data.auditorName}` : ""} · {data.status}
          </Text>
          {data.notes ? <Text style={styles.notes}>{data.notes}</Text> : null}
        </View>

        {data.findings.length === 0 ? (
          <Text style={styles.empty}>No findings recorded.</Text>
        ) : (
          data.findings.map((f) => (
            <View key={f.index} style={styles.finding} wrap={false}>
              <View style={styles.findingHead}>
                <Text style={styles.findingTitle}>
                  {f.index}. {f.title}
                </Text>
                <Text style={[styles.badge, { backgroundColor: SEVERITY_COLOR[f.severity] ?? SLATE }]}>
                  {f.severity.toUpperCase()}
                </Text>
                <Text style={[styles.badge, { backgroundColor: f.status === "resolved" ? "#166534" : MARINER }]}>
                  {f.status.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.findingMeta}>
                {[
                  f.location && `Location: ${f.location}`,
                  f.assignee && `Assignee: ${f.assignee}`,
                  f.dueDate && `Due: ${f.dueDate}`,
                ]
                  .filter(Boolean)
                  .join("  ·  ") || " "}
              </Text>
              {f.description ? <Text style={styles.desc}>{f.description}</Text> : null}
              {f.photos.length > 0 && (
                <View style={styles.photoRow}>
                  {f.photos.map((p, i) => (
                    <View key={i} style={styles.photoBox}>
                      {/* eslint-disable-next-line jsx-a11y/alt-text */}
                      <Image style={styles.photo} src={p.url} />
                      {p.caption ? <Text style={styles.caption}>{p.caption}</Text> : null}
                      {p.stamp ? <Text style={styles.stamp}>{p.stamp}</Text> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))
        )}

        <View style={styles.footer} fixed>
          <Text>{data.propertyName} · Site Audit Report</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

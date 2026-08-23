import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// Westcreek Deep Navy palette, matching src/lib/audit-report.tsx so a contract
// and a walk report look like they came from the same company.
const NAVY = "#1b355d";
const MARINER = "#1457a5";
const SLATE = "#4A5568";
const LIGHT = "#E8EDF2";

export type ContractLine = {
  index: number;
  item: string;
  costCode: string | null;
  amount: number | null;
};

export type ContractData = {
  company: string;
  propertyName: string;
  projectName: string;
  vendorName: string;
  vendorContact: string | null;
  /** The terms, with placeholders already filled. */
  body: string;
  lines: ContractLine[];
  amount: number;
  /** Shown on the price line when the vendor priced line by line. */
  linesArePriced: boolean;
  contractNumber: string;
  dateLabel: string;
  /** "Assigned directly — <reason>" when the work was let without competition. */
  awardNote: string | null;
  /** Watermarked across the page until it is executed. */
  draft: boolean;
};

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 52, fontSize: 10, color: SLATE },
  wordmark: { fontSize: 9, letterSpacing: 3, color: MARINER, textTransform: "lowercase" },
  headerBand: { marginBottom: 18, borderBottom: `2 solid ${NAVY}`, paddingBottom: 12 },
  label: { fontSize: 8, letterSpacing: 2, color: SLATE, textTransform: "uppercase" },
  title: { fontSize: 20, color: NAVY, marginTop: 2 },
  subtitle: { fontSize: 12, color: MARINER, marginTop: 2 },
  meta: { fontSize: 9, color: SLATE, marginTop: 4 },

  partyRow: { flexDirection: "row", gap: 24, marginBottom: 16 },
  party: { flex: 1 },
  partyLabel: { fontSize: 7, letterSpacing: 1.5, color: SLATE, textTransform: "uppercase" },
  partyName: { fontSize: 11, color: NAVY, marginTop: 2 },
  partyMeta: { fontSize: 9, color: SLATE, marginTop: 1 },

  priceBox: {
    marginBottom: 18,
    padding: 10,
    backgroundColor: LIGHT,
    borderRadius: 3,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: { fontSize: 9, color: SLATE, textTransform: "uppercase", letterSpacing: 1.5 },
  price: { fontSize: 16, color: NAVY },

  terms: { fontSize: 9.5, lineHeight: 1.55, color: SLATE, marginBottom: 8 },
  awardNote: { fontSize: 8.5, color: MARINER, marginBottom: 14, fontStyle: "italic" },

  sectionHead: { fontSize: 12, color: NAVY, marginBottom: 8, marginTop: 4 },
  row: {
    flexDirection: "row",
    borderBottom: `1 solid ${LIGHT}`,
    paddingVertical: 5,
    alignItems: "flex-start",
  },
  headRow: { flexDirection: "row", borderBottom: `1 solid ${NAVY}`, paddingBottom: 4 },
  colNum: { width: 22, fontSize: 8, color: SLATE },
  colItem: { flex: 1, fontSize: 9.5, color: SLATE, paddingRight: 8 },
  colCode: { width: 92, fontSize: 8.5, color: SLATE },
  colAmt: { width: 76, fontSize: 9.5, color: SLATE, textAlign: "right" },
  headText: { fontSize: 7.5, letterSpacing: 1, color: NAVY, textTransform: "uppercase" },
  totalRow: {
    flexDirection: "row",
    paddingTop: 7,
    marginTop: 2,
    borderTop: `1 solid ${NAVY}`,
    justifyContent: "flex-end",
  },
  totalLabel: { fontSize: 10, color: NAVY, marginRight: 12 },
  totalAmt: { width: 76, fontSize: 11, color: NAVY, textAlign: "right" },
  lumpNote: { fontSize: 8.5, color: SLATE, marginTop: 8, fontStyle: "italic" },

  signBlock: { marginTop: 28, flexDirection: "row", gap: 32 },
  signCol: { flex: 1 },
  signLine: { borderBottom: `1 solid ${NAVY}`, height: 30 },
  signName: { fontSize: 9, color: NAVY, marginTop: 4 },
  signMeta: { fontSize: 8, color: SLATE, marginTop: 1 },
  dateLine: { borderBottom: `1 solid ${LIGHT}`, height: 20, marginTop: 12 },

  draftMark: {
    position: "absolute",
    top: 300,
    left: 96,
    fontSize: 84,
    color: "#eef1f5",
    transform: "rotate(-32deg)",
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 52,
    right: 52,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#8a94a3",
    borderTop: `1 solid ${LIGHT}`,
    paddingTop: 6,
  },
});

/**
 * The contract.
 *
 * One generated document rather than a stored PDF with an appendix stapled on:
 * the scope table's length varies per project, so a fixed page count was never
 * going to work, and an e-signature provider needs stable coordinates for the
 * signature block. Rendering the whole thing gives both.
 */
export function ContractDocument({ data }: { data: ContractData }) {
  const paragraphs = data.body.split(/\n\s*\n/).filter((p) => p.trim());

  return (
    <Document title={`${data.contractNumber} — ${data.projectName}`}>
      <Page size="LETTER" style={styles.page}>
        {data.draft && (
          <Text style={styles.draftMark} fixed>
            DRAFT
          </Text>
        )}

        <View style={styles.headerBand}>
          <Text style={styles.wordmark}>{data.company.toLowerCase()}</Text>
          <Text style={styles.label}>Work order and subcontract</Text>
          <Text style={styles.title}>{data.projectName}</Text>
          <Text style={styles.subtitle}>{data.propertyName}</Text>
          <Text style={styles.meta}>
            {data.contractNumber} · {data.dateLabel}
          </Text>
        </View>

        <View style={styles.partyRow}>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Owner</Text>
            <Text style={styles.partyName}>{data.company}</Text>
            <Text style={styles.partyMeta}>{data.propertyName}</Text>
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Contractor</Text>
            <Text style={styles.partyName}>{data.vendorName}</Text>
            {data.vendorContact && <Text style={styles.partyMeta}>{data.vendorContact}</Text>}
          </View>
        </View>

        <View style={styles.priceBox}>
          <Text style={styles.priceLabel}>Contract price</Text>
          <Text style={styles.price}>{usd(data.amount)}</Text>
        </View>

        {data.awardNote && <Text style={styles.awardNote}>{data.awardNote}</Text>}

        {paragraphs.map((para, i) => (
          <Text key={i} style={styles.terms}>
            {para.trim()}
          </Text>
        ))}

        <View style={styles.signBlock} wrap={false}>
          <View style={styles.signCol}>
            <Text style={styles.partyLabel}>Owner</Text>
            <View style={styles.signLine} />
            <Text style={styles.signName}>{data.company}</Text>
            <Text style={styles.signMeta}>Signature</Text>
            <View style={styles.dateLine} />
            <Text style={styles.signMeta}>Date</Text>
          </View>
          <View style={styles.signCol}>
            <Text style={styles.partyLabel}>Contractor</Text>
            <View style={styles.signLine} />
            <Text style={styles.signName}>{data.vendorName}</Text>
            <Text style={styles.signMeta}>Signature</Text>
            <View style={styles.dateLine} />
            <Text style={styles.signMeta}>Date</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {data.contractNumber} · {data.propertyName} · {data.projectName}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      <Page size="LETTER" style={styles.page}>
        {data.draft && (
          <Text style={styles.draftMark} fixed>
            DRAFT
          </Text>
        )}

        <View style={styles.headerBand}>
          <Text style={styles.label}>Exhibit A</Text>
          <Text style={styles.title}>Scope of work</Text>
          <Text style={styles.meta}>
            {data.contractNumber} · {data.projectName} · {data.lines.length} item
            {data.lines.length === 1 ? "" : "s"}
          </Text>
        </View>

        <View style={styles.headRow}>
          <Text style={[styles.colNum, styles.headText]}>#</Text>
          <Text style={[styles.colItem, styles.headText]}>Item</Text>
          <Text style={[styles.colCode, styles.headText]}>Cost code</Text>
          <Text style={[styles.colAmt, styles.headText]}>Amount</Text>
        </View>

        {data.lines.map((line) => (
          <View key={line.index} style={styles.row} wrap={false}>
            <Text style={styles.colNum}>{line.index}</Text>
            <Text style={styles.colItem}>{line.item}</Text>
            <Text style={styles.colCode}>{line.costCode ?? "—"}</Text>
            <Text style={styles.colAmt}>
              {data.linesArePriced && line.amount != null ? usd(line.amount) : "—"}
            </Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmt}>{usd(data.amount)}</Text>
        </View>

        {!data.linesArePriced && (
          // A direct award is one agreed number. Showing a made-up per-line
          // split in a signed document would be inventing figures nobody quoted.
          <Text style={styles.lumpNote}>
            Priced as a lump sum for the scope above. Individual line amounts were not quoted.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text>
            {data.contractNumber} · Exhibit A
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

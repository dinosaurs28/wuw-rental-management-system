// Shared bottom-sheet styles for the money sheets (Refund to customer, Void) —
// the BlacklistSheet look.
import { StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../../constants/colors';

export const sheetStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 8, maxHeight: '92%',
  },
  content: { gap: 10, paddingBottom: 4 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.hairline, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  title: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 17, color: Colors.ink },
  body: { fontFamily: Fonts.body, fontSize: 13.5, color: Colors.ink2, lineHeight: 19 },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.ink3,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 4,
  },
  input: {
    fontFamily: Fonts.body, fontSize: 15, color: Colors.ink,
    backgroundColor: Colors.bg, borderRadius: 12, borderWidth: 1, borderColor: Colors.hairline,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  multiline: { minHeight: 84, textAlignVertical: 'top', fontSize: 14 },
  counter: { alignSelf: 'flex-end', fontFamily: Fonts.body, fontSize: 11.5, color: Colors.ink4, marginTop: -4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.hairline, backgroundColor: Colors.bg,
  },
  chipOn: { borderColor: Colors.orange, backgroundColor: Colors.orangeSoft },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 13.5, color: Colors.ink2 },
  chipTextOn: { color: Colors.orange },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  moneyLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink3 },
  moneyValue: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  card: { backgroundColor: Colors.bg, borderRadius: 12, padding: 12, gap: 4 },
  warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.availLowSoft, borderRadius: 12, padding: 12 },
  warnText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.availLow, lineHeight: 18 },
  infoText: { fontFamily: Fonts.body, fontSize: 12.5, color: Colors.ink3, lineHeight: 17 },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.ink4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface,
  },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  tickText: { flex: 1, fontFamily: Fonts.bodyMedium, fontSize: 13.5, color: Colors.ink },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.availNoneSoft, borderRadius: 12, padding: 12,
  },
  errorText: { flex: 1, fontFamily: Fonts.body, fontSize: 13, color: Colors.availNone, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.hairline, backgroundColor: Colors.bg,
  },
  cancelText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink2 },
  confirmBtn: { flex: 1.4, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14 },
  confirmDanger: { backgroundColor: Colors.availNone },
  confirmOrange: { backgroundColor: Colors.orange },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.white },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 8 },
  struck: { textDecorationLine: 'line-through', color: Colors.ink3 },
  voidBadge: {
    alignSelf: 'flex-start', fontFamily: Fonts.bodySemiBold, fontSize: 10, color: Colors.ink2,
    backgroundColor: Colors.hairline, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    overflow: 'hidden', textTransform: 'uppercase', letterSpacing: 0.5,
  },
});

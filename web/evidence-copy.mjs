// Only public synthetic examples change copy; real recordings and live data keep it.
export function evidenceCopy(snapshot, text) {
  if (snapshot?.evidenceKind !== 'synthetic' || typeof text !== 'string') return text;
  return text
    .replace(/Recorded Qloo evidence from October 6, 2026/gi, 'Synthetic example data')
    .replace(/real recorded Qloo evidence/gi, 'invented example data')
    .replace(/recorded Qloo evidence/gi, 'synthetic example data')
    .replace(/real Qloo evidence/gi, 'synthetic example data')
    .replace(/real Qloo ranks/gi, 'invented example ranks')
    .replace(/the Qloo responses are real/gi, 'the displayed scores are invented')
    .replace(/Taste evidence from Qloo/gi, 'Invented taste scores for this example')
    .replace(/exact Qloo entities/gi, 'invented fixture identities')
    .replace(/Qloo evidence among/gi, 'Synthetic evidence among')
    .replace(/Confirmed in recording/g, 'Included in synthetic fixture')
    .replace(/Qloo input influence/gi, 'Invented input influence')
    .replace(/Qloo connects their film tastes to five places in New York\./g, 'Invented scores illustrate five places in New York.');
}

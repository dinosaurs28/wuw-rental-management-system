// Static external links + contact constants, mirrored from the web app
// (apps/frontend/src/pages/ContactPage.tsx and apps/frontend/public/legal/*).

export const SITE_ORIGIN = 'https://whatuwantrentals.com';

export const LEGAL_URLS = {
  terms: `${SITE_ORIGIN}/legal/terms.html`,
  privacy: `${SITE_ORIGIN}/legal/privacy.html`,
  faq: `${SITE_ORIGIN}/legal/faq.html`,
  refund: `${SITE_ORIGIN}/legal/refund.html`,
} as const;

export type LegalDoc = keyof typeof LEGAL_URLS;

export const CONTACT = {
  businessName: 'What U Want Rentals',
  address: {
    line1: 'No. 16, Anath Nagar 1st Stage,',
    line2: 'Near Syndicate Circle',
    cityPin: 'Manipal - 576104',
  },
  phones: [
    { display: '+91 8000 800 469', tel: 'tel:+918000800469' },
    { display: '+91 8000 800 468', tel: 'tel:+918000800468' },
  ],
  // Fallback WhatsApp number (used only if the backend config is unavailable).
  whatsappFallback: '918000800469',
  hours: { days: 'All Days of the Week', time: '8:00 AM – 11:00 PM' },
  map: {
    lat: 13.347515306525745,
    lng: 74.78242847482501,
    get url() {
      return `https://www.google.com/maps/search/?api=1&query=${this.lat},${this.lng}`;
    },
  },
} as const;

// Substitute {{token}} placeholders in a WhatsApp message template, leaving
// unknown tokens literal — matches web resolveTemplate().
export function resolveTemplate(
  template: string,
  variables: Record<string, string | number> = {},
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    key in variables ? String(variables[key]) : `{{${key}}}`,
  );
}

// Build a wa.me deep link from a raw phone number (no +) and message.
export function whatsappUrl(phoneNumber: string, message?: string): string {
  const base = `https://wa.me/${phoneNumber}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

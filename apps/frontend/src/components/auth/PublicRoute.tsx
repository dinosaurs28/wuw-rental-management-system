import { Outlet } from "react-router-dom";

// The routes under this are the staff sign-in / status pages. It used to send
// a signed-in customer to /my-bookings; the website has no customer area since
// Nov 21 2026 (booking is app-only), so a leftover customer session must not
// keep staff off their sign-in page.
export const PublicRoute = () => <Outlet />;

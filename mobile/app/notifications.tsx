import NotificationInbox from '../components/notifications/NotificationInbox';

// Customer inbox (#19). Guests are bounced to sign-in by the root layout
// ('notifications' is in GUEST_BLOCKED_SEGMENTS); Fleet uses
// app/employee/notifications.tsx.
export default function CustomerNotifications() {
  return <NotificationInbox />;
}

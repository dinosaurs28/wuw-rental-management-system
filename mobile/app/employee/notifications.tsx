import NotificationInbox from '../../components/notifications/NotificationInbox';

// Fleet Executive inbox (#19). It lives under app/employee/ because the root
// layout redirects STAFF away from every non-employee route.
export default function EmployeeNotifications() {
  return <NotificationInbox />;
}

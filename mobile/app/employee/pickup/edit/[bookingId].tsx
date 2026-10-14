import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

// Edit Pickup is the pickup screen itself in edit mode (client item 1, full
// edit); this older route forwards there.
export default function EditPickupRedirect() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  return <Redirect href={`/employee/pickup/${bookingId}?edit=1` as Href} />;
}

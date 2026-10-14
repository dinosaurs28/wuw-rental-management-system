import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

// Edit Return is the return screen itself in edit mode (client item 1, full
// edit); this older route forwards there.
export default function EditReturnRedirect() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  return <Redirect href={`/employee/return/${bookingId}?edit=1` as Href} />;
}

// Old close route: the current shift screen carries "Close shift" when the
// executive may close it themselves (no cash, Nov 2026); otherwise the branch
// manager verifies the cash and closes it. Kept so old links land there.
import { Redirect, type Href } from 'expo-router';

export default function CloseShiftRedirect() {
  return <Redirect href={'/employee/shift/current' as Href} />;
}

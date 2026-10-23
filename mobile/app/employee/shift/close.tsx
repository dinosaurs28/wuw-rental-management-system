// Fleet Executives no longer close shifts (Oct 2026): the branch manager
// verifies the cash handed over and closes the shift. This route is kept so
// old links land on the current shift (running totals) instead of a dead screen.
import { Redirect, type Href } from 'expo-router';

export default function CloseShiftRedirect() {
  return <Redirect href={'/employee/shift/current' as Href} />;
}

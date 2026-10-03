import ForgotPasswordFlow from '../../components/auth/ForgotPasswordFlow';
import { authApi } from '../../lib/api';

export default function ForgotPassword() {
  return (
    <ForgotPasswordFlow
      api={authApi}
      signInRoute="/(auth)/sign-in"
      emailLabel="Email"
      emailPlaceholder="you@example.com"
    />
  );
}

import ForgotPasswordFlow from '../../components/auth/ForgotPasswordFlow';
import { employeeApi } from '../../lib/api';

export default function EmployeeForgotPassword() {
  return (
    <ForgotPasswordFlow
      api={employeeApi}
      signInRoute="/(auth)/employee-sign-in"
      emailLabel="Work Email"
      emailPlaceholder="you@company.com"
    />
  );
}

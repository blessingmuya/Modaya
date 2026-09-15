import AuthForm from "@/components/AuthForm";
import { signUp } from "@/app/actions/auth";

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}

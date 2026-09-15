import AuthForm from "@/components/AuthForm";
import { logIn } from "@/app/actions/auth";

export default function LoginPage() {
  return <AuthForm mode="login" action={logIn} />;
}

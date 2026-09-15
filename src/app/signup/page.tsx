import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { AuthForm } from '@/components/auth-form';

export const metadata = { title: 'Create account — Modaya' };

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}

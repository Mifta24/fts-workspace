import { Link } from "@/i18n/navigation";

export default function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="w-fit text-base font-semibold text-primary hover:underline">
        FTS Workspace
      </Link>
      {children}
    </main>
  );
}

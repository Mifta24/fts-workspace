export default function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      {children}
    </main>
  );
}

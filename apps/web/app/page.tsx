import { NormalizationForm } from "../components/normalization-form";
import { cs } from "../messages/cs";

export default function HomePage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-3xl content-center gap-8 px-6 py-12">
      <header className="grid gap-3">
        <p className="font-semibold uppercase tracking-[0.2em] text-emerald-800">
          ShopSmart
        </p>
        <h1 className="text-4xl font-bold tracking-tight">{cs.title}</h1>
        <p className="max-w-2xl text-lg leading-8 text-emerald-950/75">
          {cs.intro}
        </p>
      </header>
      <section className="rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-sm">
        <NormalizationForm />
      </section>
    </main>
  );
}

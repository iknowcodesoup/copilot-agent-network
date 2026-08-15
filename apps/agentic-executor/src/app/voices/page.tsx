import { VoicesView } from "../features/voices/voices_view";

export default function VoicesPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Voice models</h1>
        <p className="text-xs text-muted-foreground">
          Every voice, its training phase, and the videos that contributed to
          it.
        </p>
      </header>
      <VoicesView />
    </main>
  );
}

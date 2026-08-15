/*
 * Placeholder shell for the Voices view. Story 3.6 populates it with the
 * voice list and training controls. No data fetching here on purpose - this
 * story only moves the page, it does not add new API calls.
 */
export default function VoicesPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Voice models</h1>
        <p className="text-xs text-muted-foreground">Coming in Story 3.6.</p>
      </header>
    </main>
  );
}

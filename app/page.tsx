import { RecordCapture } from "@/components/RecordCapture";

export default function Home() {
  return (
    <>
      <h1>Discogs Photo Collector</h1>
      <p className="subtitle">Photograph a record → find it on Discogs → add it to your collection.</p>
      <RecordCapture />
    </>
  );
}

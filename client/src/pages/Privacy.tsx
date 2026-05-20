export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 text-slate-300 space-y-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold text-white">Privacy</h1>
      <p>
        Padel Analyzer processes videos you upload (or, on the web app, clips you
        fetch via YouTube when that feature is enabled) to extract pose landmarks
        and swing metrics. This page summarizes what is stored and how it is used.
      </p>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Data we hold</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Video files you upload, stored on the server under a random filename.</li>
          <li>
            Derived pose sequences (body keypoints over time), phase scores, and
            optional shot classification metadata.
          </li>
          <li>
            When authentication is enabled, your email and session identifiers so
            you can sign in; analyses are associated with your account.
          </li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Retention</h2>
        <p>
          Data stays on the server you connect to until you delete an analysis from
          the Sessions screen or an operator removes it. Self-hosted deployments are
          responsible for their own backups and retention policy.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Third parties</h2>
        <p>
          The browser app loads MediaPipe and optional ONNX models from public CDNs
          when running analysis in your browser. Hosted deployments may use error
          reporting (for example Sentry) if configured by the operator.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Contact</h2>
        <p>
          For privacy requests tied to a specific deployment, contact the operator of
          that instance (the person or team who gave you the app URL).
        </p>
      </section>
    </div>
  );
}

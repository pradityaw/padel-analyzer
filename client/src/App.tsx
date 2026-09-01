import { useEffect, type ComponentType, type ReactNode } from "react";
import { Redirect, Route, Switch, useLocation, useSearch } from "wouter";
import Upload from "./pages/Upload";
import Analysis from "./pages/Analysis";
import History from "./pages/History";
import Compare from "./pages/Compare";
import Annotate from "./pages/Annotate";
import ProCompare from "./pages/ProCompare";
import Welcome from "./pages/Home";
import Login from "./pages/Login";
import Privacy from "./pages/Privacy";
import HowToFilm from "./pages/HowToFilm";
import AppHeader from "./components/AppHeader";
import FloatingNav from "./components/ui/FloatingNav";
import { trpc } from "@/lib/trpc";

function RedirectPreserveSearch({ to }: { to: string }) {
  const search = useSearch();
  const suffix = search ? `?${search}` : "";
  return <Redirect to={`${to}${suffix}`} />;
}

function WelcomeGuard() {
  const [, navigate] = useLocation();
  const session = trpc.auth.getSession.useQuery(undefined, { retry: false });

  useEffect(() => {
    if (!session.data) return;
    if (session.data.authMode === "on" && session.data.user) {
      navigate("/app");
    }
  }, [session.data, navigate]);

  // Show the marketing page immediately; redirect signed-in users when session resolves.
  return <Welcome />;
}

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="flex-1 pb-24">{children}</main>
      <FloatingNav />
    </div>
  );
}

function withAppShell(Page: ComponentType) {
  return function PageWithAppShell() {
    return (
      <AppShell>
        <Page />
      </AppShell>
    );
  };
}

const AppHistory = withAppShell(History);
const AppUpload = withAppShell(Upload);
const AppAnalysis = withAppShell(Analysis);
const AppCompare = withAppShell(Compare);
const AppProCompare = withAppShell(ProCompare);
const AppAnnotate = withAppShell(Annotate);

export default function App() {
  return (
    <Switch>
      <Route path="/" component={WelcomeGuard} />
      <Route path="/login" component={Login} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/how-to-film" component={HowToFilm} />
      <Route path="/sessions">
        <Redirect to="/app" />
      </Route>
      <Route path="/upload">
        <RedirectPreserveSearch to="/app/upload" />
      </Route>
      <Route path="/compare">
        <RedirectPreserveSearch to="/app/compare" />
      </Route>
      <Route path="/annotate">
        <Redirect to="/app/annotate" />
      </Route>
      <Route path="/pro-compare">
        <RedirectPreserveSearch to="/app/pro-compare" />
      </Route>
      <Route path="/analysis/:id">
        {(params) => <Redirect to={`/app/analysis/${params.id}`} />}
      </Route>
      {/* Full /app/* paths (no nest) so Link href="/app/upload" stays /app/upload. */}
      <Route path="/app/upload" component={AppUpload} />
      <Route path="/app/analysis/:id" component={AppAnalysis} />
      <Route path="/app/compare" component={AppCompare} />
      <Route path="/app/pro-compare" component={AppProCompare} />
      <Route path="/app/annotate" component={AppAnnotate} />
      <Route path="/app" component={AppHistory} />
    </Switch>
  );
}

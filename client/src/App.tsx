import { Route, Switch } from "wouter";
import { AnimatePresence } from "framer-motion";
import Upload from "./pages/Upload";
import Analysis from "./pages/Analysis";
import History from "./pages/History";
import Compare from "./pages/Compare";
import Annotate from "./pages/Annotate";
import ProCompare from "./pages/ProCompare";
import Navbar from "./components/Navbar";
import ErrorBoundary from "./components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
    <div className="min-h-dvh flex flex-col">
      <Navbar />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <Switch>
            <Route path="/" component={History} />
            <Route path="/upload" component={Upload} />
            <Route path="/analysis/:id" component={Analysis} />
            <Route path="/compare" component={Compare} />
            <Route path="/annotate" component={Annotate} />
            <Route path="/pro-compare" component={ProCompare} />
          </Switch>
        </AnimatePresence>
      </main>
    </div>
    </ErrorBoundary>
  );
}

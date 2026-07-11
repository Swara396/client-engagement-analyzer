import { Link, useLocation } from "wouter";
import { ArrowRight, Brain, Mic, PieChart, ShieldCheck, UploadCloud, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Home() {
  const [, navigate] = useLocation();

  function loadDemoReport() {
    navigate("/results/demo");
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Hero Section */}
      <section className="py-24 lg:py-32 px-4 border-b border-border bg-card">
        <div className="container mx-auto max-w-5xl text-center space-y-8">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <ShieldCheck className="w-4 h-4 mr-2" />
            Enterprise-Grade Conversation Intelligence
          </div>
          <h1 className="text-5xl lg:text-7xl font-bold tracking-tight text-foreground max-w-4xl mx-auto leading-tight">
            Understand Your Clients <br/>
            <span className="text-primary">Beyond Words</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            A precision instrument for analyzing client conversations. Uncover subtle engagement markers, speaking metrics, and cognitive indicators with clinical accuracy.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-8">
            <Link href="/analyze" className="inline-flex">
              <Button size="lg" className="h-14 px-8 text-base shadow-lg">
                <UploadCloud className="w-5 h-5 mr-2" />
                Upload Recording
              </Button>
            </Link>
            <Link href="/analyze?mode=record" className="inline-flex">
              <Button size="lg" variant="outline" className="h-14 px-8 text-base">
                <Mic className="w-5 h-5 mr-2" />
                Record Live
              </Button>
            </Link>
            <Button
              size="lg"
              variant="ghost"
              className="h-14 px-8 text-base border border-border hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all"
              onClick={loadDemoReport}
            >
              <Play className="w-5 h-5 mr-2" />
              Load Simulated Sales Report
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 px-4 bg-background">
        <div className="container mx-auto max-w-6xl">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-card border border-border shadow-sm">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6">
                <Brain className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Cognitive Indicators</h3>
              <p className="text-muted-foreground leading-relaxed">
                Measure confidence, hesitation, and curiosity through advanced vocal and syntactic analysis.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-card border border-border shadow-sm">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6">
                <PieChart className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Precision Metrics</h3>
              <p className="text-muted-foreground leading-relaxed">
                Detailed breakdowns of speaking rates, pause durations, and filler word frequencies.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-card border border-border shadow-sm">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6">
                <ArrowRight className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Actionable Insights</h3>
              <p className="text-muted-foreground leading-relaxed">
                Automated executive summaries and concrete recommendations for improving client relationships.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

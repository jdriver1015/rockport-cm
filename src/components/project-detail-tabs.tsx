"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ProjectDetailTabs({
  overview,
  log,
}: {
  overview: ReactNode;
  log: ReactNode;
}) {
  return (
    <Tabs defaultValue="overview">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="log">Log</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-6 pt-4">
        {overview}
      </TabsContent>
      <TabsContent value="log" className="pt-4">
        {log}
      </TabsContent>
    </Tabs>
  );
}

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Clean() {
  return (
    <Tabs>
      <TabsList><TabsTrigger>全部</TabsTrigger></TabsList>
      <Button variant="outline">保存</Button>
    </Tabs>
  );
}

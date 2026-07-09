import { createProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-[#1b355d]">New project</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createProject} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Property name</Label>
              <Input id="name" name="name" required placeholder="Retreat at Westpark" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entity">Entity</Label>
              <Input id="entity" name="entity" placeholder="Retreat at Westpark, LLC" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" placeholder="Houston" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input id="state" name="state" placeholder="TX" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unitCount">Unit count</Label>
                <Input id="unitCount" name="unitCount" type="number" min="1" placeholder="156" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pmSystem">PM system</Label>
                <Input id="pmSystem" name="pmSystem" placeholder="BH / Yardi" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="submit">Create project</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

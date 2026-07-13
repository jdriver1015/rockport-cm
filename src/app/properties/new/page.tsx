import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewPropertyForm } from "@/components/new-property-form";

export default function NewPropertyPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-navy">New property</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPropertyForm />
        </CardContent>
      </Card>
    </div>
  );
}

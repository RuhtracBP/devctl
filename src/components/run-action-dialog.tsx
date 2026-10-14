import { useState } from "react";
import type { Action } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RunActionDialogProps {
  action: Action | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (paramValues: Record<string, string>) => void;
}

/**
 * Coleta os `params` de uma action antes de rodar (só abre quando a
 * action tem pelo menos um param — ver App.tsx). Ações `confirm=true`
 * mostram o aviso aqui também, então a mesma confirmação serve pros
 * dois casos em vez de empilhar dois diálogos.
 */
export function RunActionDialog({
  action,
  onOpenChange,
  onConfirm,
}: RunActionDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) setValues({});
        onOpenChange(open);
      }}
    >
      <DialogContent>
        {action && (
          <>
            <DialogHeader>
              <DialogTitle>{action.label}</DialogTitle>
              {action.confirm && (
                <DialogDescription className="text-destructive">
                  ⚠ {action.confirm_message}
                </DialogDescription>
              )}
            </DialogHeader>

            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                onConfirm(values);
                setValues({});
              }}
            >
              {action.params.map((param) => (
                <div key={param.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={`param-${param.name}`}>
                    {param.label}
                    {param.required && " *"}
                  </Label>
                  {param.type === "enum" ? (
                    <select
                      id={`param-${param.name}`}
                      className="h-8 rounded-lg border border-input bg-background px-2 text-sm dark:bg-input/30"
                      value={values[param.name] ?? param.default ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [param.name]: e.currentTarget.value,
                        }))
                      }
                      required={param.required}
                    >
                      <option value="" disabled>
                        selecione…
                      </option>
                      {param.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={`param-${param.name}`}
                      value={values[param.name] ?? param.default ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [param.name]: e.currentTarget.value,
                        }))
                      }
                      required={param.required}
                    />
                  )}
                </div>
              ))}

              <DialogFooter>
                <Button type="submit" variant={action.confirm ? "destructive" : "default"}>
                  {action.confirm ? "Confirmar e executar" : "Executar"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

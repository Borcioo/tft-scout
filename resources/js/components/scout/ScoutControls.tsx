import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type Props = {
    level: number;
    topN: number;
    max5Cost: number | null;
    roleBalance: boolean;
    minFrontline: number;
    minDps: number;
    isRunning: boolean;
    onLevelChange: (value: number) => void;
    onTopNChange: (value: number) => void;
    onMax5CostChange: (value: number | null) => void;
    onRoleBalanceChange: (value: boolean) => void;
    onMinFrontlineChange: (value: number) => void;
    onMinDpsChange: (value: number) => void;
    onRun: () => void;
};

export function ScoutControls({
    level,
    topN,
    max5Cost,
    roleBalance,
    minFrontline,
    minDps,
    isRunning,
    onLevelChange,
    onTopNChange,
    onMax5CostChange,
    onRoleBalanceChange,
    onMinFrontlineChange,
    onMinDpsChange,
    onRun,
}: Props) {
    return (
        <div className="flex flex-col gap-5 rounded-lg border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Scout Settings
            </h2>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Level</Label>
                    <span className="font-mono text-sm">{level}</span>
                </div>
                <Slider
                    value={[level]}
                    min={6}
                    max={10}
                    step={1}
                    onValueChange={([v]) => onLevelChange(v)}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Top results</Label>
                    <span className="font-mono text-sm">{topN}</span>
                </div>
                <Slider
                    value={[topN]}
                    min={5}
                    max={30}
                    step={5}
                    onValueChange={([v]) => onTopNChange(v)}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Max 5-cost</Label>
                    <span className="font-mono text-sm">
                        {max5Cost === null ? '∞' : max5Cost}
                    </span>
                </div>
                <Slider
                    value={[max5Cost ?? 5]}
                    min={0}
                    max={5}
                    step={1}
                    onValueChange={([v]) => onMax5CostChange(v === 5 ? null : v)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label htmlFor="role-balance">Role balance</Label>
                <Switch
                    id="role-balance"
                    checked={roleBalance}
                    onCheckedChange={onRoleBalanceChange}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Min Frontline</Label>
                    <span className="font-mono text-sm">{minFrontline}</span>
                </div>
                <Slider
                    value={[minFrontline]}
                    min={0}
                    max={6}
                    step={1}
                    onValueChange={([v]) => onMinFrontlineChange(v)}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Min DPS</Label>
                    <span className="font-mono text-sm">{minDps}</span>
                </div>
                <Slider
                    value={[minDps]}
                    min={0}
                    max={6}
                    step={1}
                    onValueChange={([v]) => onMinDpsChange(v)}
                />
            </div>

            <Button onClick={onRun} disabled={isRunning} className="w-full">
                {isRunning ? 'Running…' : 'Run scout'}
            </Button>
        </div>
    );
}

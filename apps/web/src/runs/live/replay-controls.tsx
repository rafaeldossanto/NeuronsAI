import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatDuration } from "@/shared/format";
import { MAX_GAP_MS, MIN_GAP_MS, REPLAY_SPEEDS, type Replay } from "./replay";
import type { ReplayPlayer } from "./use-replay-player";

const speedLabel = (speed: number) => `${String(speed).replace(".", ",")}×`;

/**
 * The replay's bar: play/pause, one event back or forward, the speed, and a slider over the events.
 * It also says, in the open, what the replay is not: the waits are shortened and the terminal is
 * not reproduced.
 */
export function ReplayControls({ player, replay }: { player: ReplayPlayer; replay: Replay }) {
  const { position, total } = player;
  const current = position > 0 ? replay.events[position - 1] : undefined;
  const elapsed = position > 0 ? (replay.elapsedMs[position - 1] ?? 0) : 0;

  return (
    <section
      aria-label="Controles do replay"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={player.stepBack}
          disabled={position === 0}
          aria-label="Voltar um evento"
        >
          <SkipBack className="size-4" aria-hidden />
        </Button>
        <Button
          size="sm"
          onClick={player.toggle}
          disabled={total === 0}
          aria-label={player.playing ? "Pausar" : player.atEnd && total > 0 ? "Recomeçar" : "Tocar"}
        >
          {player.playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
          {player.playing ? "Pausar" : player.atEnd && total > 0 ? "Recomeçar" : "Tocar"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={player.stepForward}
          disabled={player.atEnd}
          aria-label="Avançar um evento"
        >
          <SkipForward className="size-4" aria-hidden />
        </Button>
        <div role="group" aria-label="Velocidade" className="ml-auto flex gap-1">
          {REPLAY_SPEEDS.map((speed) => (
            <Button
              key={speed}
              size="sm"
              variant={player.speed === speed ? "default" : "outline"}
              aria-pressed={player.speed === speed}
              onClick={() => player.setSpeed(speed)}
            >
              {speedLabel(speed)}
            </Button>
          ))}
        </div>
      </div>

      <input
        type="range"
        aria-label="Posição no replay"
        min={0}
        max={total}
        step={1}
        value={position}
        onChange={(event) => player.seek(Number(event.target.value))}
        className="w-full accent-[#E9A15C]"
        aria-valuetext={`Evento ${position} de ${total}`}
      />

      <p role="status" aria-label="Posição" className="text-sm">
        <strong>
          Evento {position} de {total}
        </strong>
        {current && (
          <span className="text-muted-foreground">
            {" "}
            · #{current.seq} {current.type}
            {current.agent ? ` · @${current.agent.replace(/^@/, "")}` : ""} ·{" "}
            {formatDuration(elapsed)} de {formatDuration(replay.realMs)} da execução
          </span>
        )}
        {total === 0 && (
          <span className="text-muted-foreground"> · esta execução não tem eventos</span>
        )}
      </p>

      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        <li>
          Tempo: os eventos tocam pelos horários em que aconteceram, divididos pela velocidade.
          Esperas maiores que {MAX_GAP_MS / 1000} s (em 1×) são encurtadas para {MAX_GAP_MS / 1000}{" "}
          s
          {replay.shortenedGaps > 0 &&
            `; aqui foram ${replay.shortenedGaps} ${replay.shortenedGaps === 1 ? "trecho" : "trechos"}`}
          . Eventos colados esperam ao menos {MIN_GAP_MS} ms. Em 1×, o replay dura cerca de{" "}
          {formatDuration(Math.round(replay.playMs))}; a execução levou{" "}
          {formatDuration(Math.round(replay.realMs))}.
        </li>
        <li>
          O terminal não é reproduzido: a saída dele não fica no registro da execução. O replay
          mostra mensagens, ferramentas, estados e custos.
        </li>
      </ul>
    </section>
  );
}

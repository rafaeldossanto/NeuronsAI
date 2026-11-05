export interface paths {
    "/auth/google": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Inicia login Google no navegador do sistema. */
        post: operations["auth_begin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Confirma o retorno Google e cria sessão protegida. */
        get: operations["auth_complete"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Encerra a sessão e apaga os cookies. */
        post: operations["auth_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/organization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Muda para uma organização da sua conta e substitui a sessão. */
        post: operations["auth_selectOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista as organizações da sessão atual. */
        get: operations["auth_organizations"];
        put?: never;
        /** Cria uma organização com você como proprietário. */
        post: operations["auth_createOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/organizations/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista membros de uma organização da sua conta. */
        get: operations["auth_members"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/organizations/{id}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Define o papel de uma conta existente ou remove seu vínculo. */
        put: operations["auth_setMember"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Renova a sessão protegida por cookie e CSRF. */
        post: operations["auth_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Estado do login, sem credenciais. */
        get: operations["auth_session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Estado das conexões de IA sem expor credenciais. */
        get: operations["connections_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections/claude/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Abre o login oficial do Claude Code no computador local. */
        post: operations["connections_signIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/graphs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista os grafos. */
        get: operations["graphs_list"];
        put?: never;
        /** Cria um grafo (com rascunho opcional). */
        post: operations["graphs_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/graphs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mostra um grafo, com o rascunho. */
        get: operations["graphs_get"];
        put?: never;
        post?: never;
        /** Apaga um grafo que ainda não tem versões publicadas. */
        delete: operations["graphs_remove"];
        options?: never;
        head?: never;
        /** Renomeia o grafo e/ou salva o rascunho. */
        patch: operations["graphs_update"];
        trace?: never;
    };
    "/graphs/{id}/triggers/{triggerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mostra o estado de um gatilho externo: ativo, rota do webhook, se tem segredo, última e próxima execução. */
        get: operations["graphs_getTrigger"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/graphs/{id}/triggers/{triggerId}/enabled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Ativa ou desativa o gatilho. Ativar exige o gatilho na versão publicada mais recente (e o segredo, no webhook). */
        put: operations["graphs_setTriggerEnabled"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/graphs/{id}/triggers/{triggerId}/secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Gera o segredo do webhook (ou troca o atual, que deixa de valer na hora). O segredo só aparece nesta resposta. */
        post: operations["graphs_rotateTriggerSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/graphs/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista as versões publicadas do grafo, da mais antiga à mais nova. */
        get: operations["graphs_listVersions"];
        put?: never;
        /** Valida o grafo e congela uma nova versão (sem corpo, publica o rascunho). */
        post: operations["graphs_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/graphs/{id}/versions/{version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mostra uma versão publicada, com a definição congelada. */
        get: operations["graphs_getVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/memories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista as memórias cadastradas. */
        get: operations["memories_list"];
        put?: never;
        /** Conecta um cofre local ou cria/importa uma memória no servidor. */
        post: operations["memories_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/memories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Detalha uma memória. */
        get: operations["memories_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runners": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista os runners da organização, sem tokens. */
        get: operations["runners_list"];
        put?: never;
        /** Emite um token de runner, mostrado uma única vez. */
        post: operations["runners_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runners/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoga um runner da organização. */
        delete: operations["runners_revoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista as execuções com filtros e paginação (offset); das mais novas para as mais antigas por padrão. */
        get: operations["runs_list"];
        put?: never;
        /** Inicia uma execução de uma versão publicada do grafo. */
        post: operations["runs_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mostra uma execução: estado, motivo do fim e consumo. */
        get: operations["runs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista os eventos da execução, em ordem (o mesmo log que o WebSocket transmite). */
        get: operations["runs_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista as mensagens da execução, em ordem. */
        get: operations["runs_messages"];
        put?: never;
        /** Manda uma mensagem, como você (@human), a qualquer agente da execução. */
        post: operations["runs_sendMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{id}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Para a execução: encerra os runtimes e os terminais dos agentes. */
        post: operations["runs_stop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/secrets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lista os nomes dos segredos (nunca os valores). */
        get: operations["secrets_listNames"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/secrets/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Grava ou substitui um segredo. O valor não volta em nenhuma resposta. */
        put: operations["secrets_write"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ErrorBody: {
            code: string;
            message: string;
            details?: components["schemas"]["ErrorDetail"][];
        };
        ErrorDetail: {
            path?: string;
            code?: string;
            message: string;
            nodeId?: string;
            linkId?: string;
        };
        Graph: {
            /** Format: uuid */
            id: string;
            name: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            draft: unknown;
            latestVersion: number | null;
        };
        GraphSummary: {
            /** Format: uuid */
            id: string;
            name: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        GraphVersion: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            graphId: string;
            version: number;
            /** Format: date-time */
            createdAt: string;
            definition: {
                /** @constant */
                schemaVersion: 1;
                /** Format: uuid */
                id: string;
                name: string;
                nodes: ({
                    id: string;
                    position: {
                        x: number;
                        y: number;
                    };
                    /** @constant */
                    type: "trigger";
                    /** @enum {string} */
                    kind: "manual" | "webhook" | "schedule";
                    target: string;
                    cron?: string;
                    timezone?: string;
                } | {
                    id: string;
                    position: {
                        x: number;
                        y: number;
                    };
                    /** @constant */
                    type: "agent";
                    name: string;
                    role: string;
                    instructions: string;
                    /** @enum {string} */
                    effort: "low" | "medium" | "high" | "xhigh" | "max";
                    budgetUsd?: number;
                    idleTimeoutSec?: number;
                    runtime: {
                        /** @constant */
                        kind: "api";
                        provider: string;
                        model: string;
                        /** @enum {string} */
                        access?: "api-key" | "subscription";
                        secretName?: string;
                    } | {
                        /** @constant */
                        kind: "terminal";
                        /** @enum {string} */
                        cli: "claude" | "codex" | "gemini" | "custom";
                        model?: string;
                        /**
                         * @default pty
                         * @enum {string}
                         */
                        mode: "pty" | "stream-json";
                        command?: string;
                        /** @default [] */
                        args: string[];
                        cwd: string;
                        /** @enum {string} */
                        access?: "subscription" | "api-key";
                        secretName?: string;
                    };
                } | {
                    id: string;
                    position: {
                        x: number;
                        y: number;
                    };
                    /** @constant */
                    type: "tool";
                    name: string;
                    tool: ({
                        /** @constant */
                        kind: "mcp";
                        /** @constant */
                        transport: "stdio";
                        command: string;
                        args: string[];
                        env?: {
                            [key: string]: string;
                        };
                        allowedTools: string[];
                    } | {
                        /** @constant */
                        kind: "mcp";
                        /** @constant */
                        transport: "http";
                        /** Format: uri */
                        url: string;
                        allowedTools: string[];
                    }) | {
                        /** @constant */
                        kind: "http";
                        /** @enum {string} */
                        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
                        /** Format: uri */
                        url: string;
                        headers: {
                            [key: string]: string;
                        };
                        bodySchema?: unknown;
                    } | {
                        /** @constant */
                        kind: "obsidian";
                        vaultPath?: string;
                        /** Format: uuid */
                        memoryId?: string;
                        readOnly: boolean;
                    };
                })[];
                links: {
                    id: string;
                    from: string;
                    to: string;
                    /** @enum {string} */
                    kind: "talk" | "uses";
                    /** @default false */
                    bidirectional: boolean;
                    maxMessages?: number;
                    readOnly?: boolean;
                }[];
                annotations: {
                    id: string;
                    /** @enum {string} */
                    kind: "rect" | "ellipse" | "arrow" | "text" | "note" | "group";
                    position: {
                        x: number;
                        y: number;
                    };
                    size?: {
                        width: number;
                        height: number;
                    };
                    points?: {
                        x: number;
                        y: number;
                    }[];
                    text?: string;
                    style?: {
                        [key: string]: string | number;
                    };
                    memberIds?: string[];
                }[];
            };
        };
        GraphVersionSummary: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            graphId: string;
            version: number;
            /** Format: date-time */
            createdAt: string;
        };
        Message: {
            /** Format: uuid */
            id: string;
            seq: number;
            from: string;
            to: string;
            /** @enum {string} */
            kind: "message" | "ask" | "reply";
            replyTo: string | null;
            body: string;
            /** Format: date-time */
            createdAt: string;
            deliveredAt: string | null;
            ackedAt: string | null;
        };
        RunDetail: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            graphId: string;
            /** Format: uuid */
            graphVersionId: string;
            /** @enum {string} */
            status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
            budgetUsd: number | null;
            startedAt: string | null;
            finishedAt: string | null;
            input: string;
            finish: components["schemas"]["RunFinish"] | null;
            usage: {
                total: components["schemas"]["UsageTotals"];
                byAgent: {
                    [key: string]: components["schemas"]["UsageTotals"];
                };
            };
        };
        RunEvent: {
            /** Format: uuid */
            runId: string;
            seq: number;
            type: string;
            agent: string | null;
            payload: unknown;
            /** Format: date-time */
            at: string;
        };
        RunFinish: {
            /** @enum {string} */
            reason: "finished" | "quiescent" | "stopped" | "failed" | "guard_tripped";
            /** Format: date-time */
            at: string;
            agent?: string;
            result?: string;
            error?: string;
            guard?: string;
            message?: string;
        };
        RunListItem: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            graphId: string;
            /** Format: uuid */
            graphVersionId: string;
            /** @enum {string} */
            status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
            budgetUsd: number | null;
            startedAt: string | null;
            finishedAt: string | null;
            graphName: string;
            graphVersion: number;
            durationMs: number | null;
            costUsd: number;
            turns: number;
            unknownCostTurns: number;
        };
        TriggerSecret: {
            secret: string;
            state: components["schemas"]["TriggerState"];
        };
        TriggerState: {
            triggerId: string;
            enabled: boolean;
            hookPath: string | null;
            hooksPort: number | null;
            hasSecret: boolean;
            secretSetAt: string | null;
            lastRun: {
                /** Format: date-time */
                at: string;
                /** @enum {string} */
                outcome: "started" | "skipped_overlap" | "skipped_missed" | "failed";
                note: string | null;
                runId: string | null;
            } | null;
            nextRunAt: string | null;
        };
        UsageTotals: {
            costUsd: number;
            turns: number;
            unknownCostTurns: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    auth_begin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uri */
                        authorizationUrl: string;
                    };
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Erro. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_complete: {
        parameters: {
            query?: {
                state?: string;
                code?: string;
                error?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso, sem conteúdo. */
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso, sem conteúdo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_selectOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    organizationId: string;
                };
            };
        };
        responses: {
            /** @description Sucesso, sem conteúdo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_organizations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            role: "owner" | "admin" | "member" | "viewer";
                        }[];
                    };
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_createOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_members: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            userId: string;
                            displayName: string;
                            /** @enum {string} */
                            role: "owner" | "admin" | "member" | "viewer";
                        }[];
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_setMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    role: ("owner" | "admin" | "member" | "viewer") | null;
                };
            };
        };
        responses: {
            /** @description Sucesso, sem conteúdo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflito com o estado atual. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_refresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso, sem conteúdo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    auth_session: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        enabled: boolean;
                        authenticated: boolean;
                        /** Format: uuid */
                        userId?: string;
                        /** Format: uuid */
                        organizationId?: string;
                        /** @enum {string} */
                        role?: "owner" | "admin" | "member" | "viewer";
                        csrfToken?: string;
                    };
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    connections_status: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        profile: "local" | "hybrid" | "hosted";
                        secretsEnabled: boolean;
                        claude: {
                            installed: boolean;
                            connected: boolean;
                            signingIn: boolean;
                            message: string;
                        };
                        chatgpt: {
                            available: boolean;
                            message: string;
                        };
                    };
                };
            };
        };
    };
    connections_signIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        started: boolean;
                    };
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["GraphSummary"][];
                    };
                };
            };
        };
    };
    graphs_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    draft?: unknown;
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Graph"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Graph"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso, sem conteúdo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflito com o estado atual. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    draft?: unknown;
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Graph"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_getTrigger: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TriggerState"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_setTriggerEnabled: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    enabled: boolean;
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TriggerState"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflito com o estado atual. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_rotateTriggerSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TriggerSecret"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_listVersions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["GraphVersionSummary"][];
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_publish: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    definition?: {
                        /** @constant */
                        schemaVersion: 1;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        nodes: ({
                            id: string;
                            position: {
                                x: number;
                                y: number;
                            };
                            /** @constant */
                            type: "trigger";
                            /** @enum {string} */
                            kind: "manual" | "webhook" | "schedule";
                            target: string;
                            cron?: string;
                            timezone?: string;
                        } | {
                            id: string;
                            position: {
                                x: number;
                                y: number;
                            };
                            /** @constant */
                            type: "agent";
                            name: string;
                            role: string;
                            instructions: string;
                            /** @enum {string} */
                            effort: "low" | "medium" | "high" | "xhigh" | "max";
                            budgetUsd?: number;
                            idleTimeoutSec?: number;
                            runtime: {
                                /** @constant */
                                kind: "api";
                                provider: string;
                                model: string;
                                /** @enum {string} */
                                access?: "api-key" | "subscription";
                                secretName?: string;
                            } | {
                                /** @constant */
                                kind: "terminal";
                                /** @enum {string} */
                                cli: "claude" | "codex" | "gemini" | "custom";
                                model?: string;
                                /**
                                 * @default pty
                                 * @enum {string}
                                 */
                                mode?: "pty" | "stream-json";
                                command?: string;
                                /** @default [] */
                                args?: string[];
                                cwd: string;
                                /** @enum {string} */
                                access?: "subscription" | "api-key";
                                secretName?: string;
                            };
                        } | {
                            id: string;
                            position: {
                                x: number;
                                y: number;
                            };
                            /** @constant */
                            type: "tool";
                            name: string;
                            tool: ({
                                /** @constant */
                                kind: "mcp";
                                /** @constant */
                                transport: "stdio";
                                command: string;
                                args: string[];
                                env?: {
                                    [key: string]: string;
                                };
                                allowedTools: string[];
                            } | {
                                /** @constant */
                                kind: "mcp";
                                /** @constant */
                                transport: "http";
                                /** Format: uri */
                                url: string;
                                allowedTools: string[];
                            }) | {
                                /** @constant */
                                kind: "http";
                                /** @enum {string} */
                                method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
                                /** Format: uri */
                                url: string;
                                headers: {
                                    [key: string]: string;
                                };
                                bodySchema?: unknown;
                            } | {
                                /** @constant */
                                kind: "obsidian";
                                vaultPath?: string;
                                /** Format: uuid */
                                memoryId?: string;
                                readOnly: boolean;
                            };
                        })[];
                        links: {
                            id: string;
                            from: string;
                            to: string;
                            /** @enum {string} */
                            kind: "talk" | "uses";
                            /** @default false */
                            bidirectional?: boolean;
                            maxMessages?: number;
                            readOnly?: boolean;
                        }[];
                        annotations: {
                            id: string;
                            /** @enum {string} */
                            kind: "rect" | "ellipse" | "arrow" | "text" | "note" | "group";
                            position: {
                                x: number;
                                y: number;
                            };
                            size?: {
                                width: number;
                                height: number;
                            };
                            points?: {
                                x: number;
                                y: number;
                            }[];
                            text?: string;
                            style?: {
                                [key: string]: string | number;
                            };
                            memberIds?: string[];
                        }[];
                    };
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GraphVersion"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    graphs_getVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                version: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GraphVersion"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    memories_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            storage: "local" | "server";
                            vaultPath?: string;
                            runner?: string;
                            fileCount: number;
                            /** Format: date-time */
                            createdAt: string;
                        }[];
                    };
                };
            };
        };
    };
    memories_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @enum {string} */
                    storage: "local" | "server";
                    vaultPath?: string;
                    files?: {
                        path: string;
                        data: string;
                    }[];
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        /** @enum {string} */
                        storage: "local" | "server";
                        vaultPath?: string;
                        runner?: string;
                        fileCount: number;
                        /** Format: date-time */
                        createdAt: string;
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    memories_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        /** @enum {string} */
                        storage: "local" | "server";
                        vaultPath?: string;
                        runner?: string;
                        fileCount: number;
                        /** Format: date-time */
                        createdAt: string;
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runners_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            createdAt: string;
                            lastSeenAt: string | null;
                            revokedAt: string | null;
                        }[];
                    };
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runners_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        token: string;
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflito com o estado atual. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runners_revoke: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso, sem conteúdo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runs_list: {
        parameters: {
            query?: {
                status?: "pending" | "running" | "succeeded" | "failed" | "cancelled";
                graphId?: string;
                graphVersionId?: string;
                minCostUsd?: number;
                maxCostUsd?: number;
                from?: string;
                to?: string;
                sort?: "startedAt" | "costUsd";
                order?: "asc" | "desc";
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["RunListItem"][];
                        total: number;
                        limit: number;
                        offset: number;
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runs_start: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    graphVersionId: string;
                    input: string;
                    triggerId?: string;
                    budgetUsd?: number;
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunDetail"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runs_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunDetail"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runs_events: {
        parameters: {
            query?: {
                fromSeq?: number;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["RunEvent"][];
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runs_messages: {
        parameters: {
            query?: {
                afterSeq?: number;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Message"][];
                    };
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runs_sendMessage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    to: string;
                    body: string;
                };
            };
        };
        responses: {
            /** @description Sucesso. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não permitido. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflito com o estado atual. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    runs_stop: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunDetail"];
                };
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Não encontrado. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    secrets_listNames: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sucesso. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        names: string[];
                    };
                };
            };
        };
    };
    secrets_write: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    value: string;
                };
            };
        };
        responses: {
            /** @description Sucesso, sem conteúdo. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Requisição inválida. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Indisponível no momento. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
}


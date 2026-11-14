/* global window, document, location, ResizeObserver, IntersectionObserver, devicePixelRatio, innerWidth, requestAnimationFrame, setTimeout, URLSearchParams, MouseEvent */

(function () {
  "use strict";
  document.documentElement.classList.add("enhanced");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var still = new URLSearchParams(location.search).has("still");
  if (still) document.documentElement.classList.add("still");
  var easeCurve = function (x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  };
  var TAU = Math.PI * 2;
  var randomState = 871425;
  function random() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }
  var paths = [
    [
      [1130, 465],
      [1050, 410],
      [977, 369],
      [897, 313],
      [805, 241],
      [735, 163],
      [650, 127],
    ],
    [
      [1155, 465],
      [1189, 366],
      [1212, 276],
      [1255, 200],
      [1293, 125],
      [1348, 12],
    ],
    [
      [1180, 470],
      [1261, 375],
      [1346, 320],
      [1440, 265],
      [1538, 202],
      [1600, 195],
    ],
    [
      [1180, 490],
      [1280, 525],
      [1385, 554],
      [1483, 558],
      [1600, 540],
    ],
    [
      [1175, 510],
      [1254, 597],
      [1356, 675],
      [1454, 739],
      [1575, 812],
    ],
    [
      [1100, 495],
      [1016, 540],
      [915, 595],
      [827, 650],
      [738, 720],
      [652, 802],
    ],
    [
      [1100, 435],
      [1005, 384],
      [923, 399],
      [825, 440],
      [720, 477],
      [622, 530],
    ],
    [
      [1115, 520],
      [1105, 607],
      [1124, 701],
      [1139, 823],
    ],
  ];
  function preparePath(vertices) {
    var segments = [],
      length = 0;
    for (var i = 1; i < vertices.length; i++) {
      var a = vertices[i - 1],
        b = vertices[i],
        size = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segments.push({ a: a, b: b, size: size, start: length });
      length += size;
    }
    return { segments: segments, length: length };
  }
  var prepared = paths.map(preparePath);
  function nearest(x, y, network) {
    var best = { distance: Infinity, branch: 0, q: 0 };
    network.forEach(function (path, index) {
      path.segments.forEach(function (segment) {
        var vx = segment.b[0] - segment.a[0],
          vy = segment.b[1] - segment.a[1];
        var t = Math.max(
          0,
          Math.min(
            1,
            ((x - segment.a[0]) * vx + (y - segment.a[1]) * vy) / (segment.size * segment.size),
          ),
        );
        var distance = Math.hypot(x - segment.a[0] - t * vx, y - segment.a[1] - t * vy);
        if (distance < best.distance)
          best = {
            distance: distance,
            branch: index,
            q: (segment.start + t * segment.size) / path.length,
          };
      });
    });
    return best;
  }

  function makePoint(x, y, amber, network) {
    var info = nearest(x, y, network);
    return {
      x: x,
      y: y,
      amber: amber,
      branch: info.branch,
      q: info.q,
      distance: info.distance,
      r: 0.62 + random() * 0.38,
      phase: random() * TAU,
      drift: 1.1 + random() * 2.2,
    };
  }
  var branchVertices = [
    [
      [25, 278],
      [150, 257],
      [270, 215],
      [390, 175],
      [520, 140],
      [700, 107],
    ],
    [
      [270, 215],
      [218, 160],
      [162, 112],
      [76, 91],
    ],
    [
      [390, 175],
      [430, 110],
      [473, 58],
      [540, 22],
    ],
    [
      [520, 140],
      [593, 194],
      [650, 233],
      [735, 250],
    ],
    [
      [270, 215],
      [250, 278],
      [227, 324],
    ],
  ];
  var branchNetwork = branchVertices.map(preparePath);
  // The point data is ~180 KB: it is its own chunk, fetched after the page is up instead of being part
  // of the first script. Both sets are built together, in the original order, so the seeded random
  // numbers (and so the look of the field) stay exactly the same.
  var pointsPromise = null;
  function loadPoints() {
    pointsPromise =
      pointsPromise ||
      import("./particle-data.json").then(function (module) {
        var data = module.default;
        return {
          hero: data.hero.map(function (p) {
            return makePoint(p[0], p[1], !!p[2], prepared);
          }),
          branch: data.branch.map(function (p) {
            return makePoint(p[0], p[1], !!p[2], branchNetwork);
          }),
        };
      });
    return pointsPromise;
  }
  var fields = [];
  function ParticleField(canvas, points, network, kind) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.points = points;
    this.network = network;
    this.kind = kind;
    this.visible = true;
    this.width = 0;
    this.height = 0;

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      requestFrame();
    });
    this.resizeObserver.observe(canvas.parentElement);
    var observer = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0].isIntersecting;
        requestFrame();
      },
      { rootMargin: "80px", threshold: 0 },
    );
    observer.observe(canvas);
    this.resize();
  }
  ParticleField.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio || 1, 1.5);
    this.width = rect.width;
    this.height = rect.height;
    this.ratio = ratio;
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.fadeStart = 0;
    this.fadeEnd = 0;
    if (this.kind === "hero") {
      var mobile = innerWidth < 640;
      this.scale = mobile ? Math.max(rect.width / 980, 0.39) * 1.08 : (rect.width / 1586) * 1.12;
      this.offsetX = mobile
        ? rect.width * 0.57 - 1130 * this.scale
        : rect.width * 0.65 - 1130 * this.scale;
      this.heroHeight = mobile ? rect.height : document.getElementById("inicio").clientHeight;
      this.extension = mobile ? 0 : Math.max(0, rect.height - this.heroHeight);
      this.offsetY = this.heroHeight * 0.59 - 480 * this.scale;
      if (this.extension) {
        this.fadeStart = this.heroHeight - 80;
        this.fadeEnd = rect.height - 8;
      }
    } else {
      var baseHeight = innerWidth < 640 ? 320 : 352;
      this.scale = Math.max(rect.width / 735, 0.6);
      this.offsetX = rect.width - 735 * this.scale;
      this.offsetY = (baseHeight - 340 * this.scale) / 2;
      this.extension = Math.max(0, rect.height - baseHeight);
      var boundary = this.canvas.closest(".statement").getBoundingClientRect().bottom - rect.top;
      var lastY =
        this.points.reduce(function (max, p) {
          return Math.max(max, p.y);
        }, 0) *
          this.scale +
        this.offsetY +
        this.extension * 0.92;
      this.fadeStart = boundary - 80;
      this.fadeEnd = Math.min(rect.height - 8, lastY - 12);
    }
  };
  ParticleField.prototype.draw = function (time) {
    var ctx = this.ctx,
      w = this.width,
      h = this.height,
      scale = this.scale;
    if (!w || !h) return;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var moving = !(reduced || still),
      wave = (time * TAU) / 4.3,
      signals = [],
      black = [],
      baseAmber = [];
    var appear = moving ? Math.min(1, time / 1.8) : 1;
    for (var i = 0; i < this.points.length; i++) {
      var p = this.points[i];
      var drift = moving ? p.drift : 0;
      var dx = (Math.sin(wave + p.phase) - Math.sin(p.phase)) * drift;
      var dy = (Math.cos(wave * 0.5 + p.phase) - Math.cos(p.phase)) * drift;
      var breathe = moving ? Math.sin(wave) * 0.005 : 0;
      var cx = this.kind === "hero" ? 1130 : 390,
        cy = this.kind === "hero" ? 470 : 175;
      var x = (p.x + dx + (p.x - cx) * breathe) * scale + this.offsetX,
        y = (p.y + dy + (p.y - cy) * breathe) * scale + this.offsetY;
      if (this.extension) {
        y +=
          this.extension *
          0.92 *
          easeCurve(
            (p.y - (this.kind === "hero" ? 620 : 210)) / (this.kind === "hero" ? 174 : 130),
          );
      }
      if (x < 0 || x > w || y < 0 || y > h) continue;
      var radius = Math.max(0.44, p.r * scale) * 1.2;
      var phase = ((time + (p.branch % 3) * 0.49) % 2.85) / 2.85,
        head = this.kind === "hero" && p.branch < 3 ? 1 - phase : phase;
      var packet =
        moving && p.distance < 40
          ? easeCurve(1 - Math.abs(p.q - head) / 0.065) * easeCurve(1 - p.distance / 42)
          : 0;
      if (packet > 0.25) {
        signals.push({ x: x, y: y, r: radius + 0.55 * packet, alpha: packet });
      } else if (p.amber) {
        baseAmber.push({ x: x, y: y, r: radius });
      } else {
        black.push({ x: x, y: y, r: radius });
      }
    }
    ctx.globalAlpha = appear;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    black.forEach(function (p) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, TAU);
    });
    ctx.fill();
    ctx.fillStyle = "#d99b55";
    ctx.globalAlpha = 0.75 * appear;
    ctx.beginPath();
    baseAmber.forEach(function (p) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, TAU);
    });
    ctx.fill();
    ctx.shadowColor = "#f3a341";
    ctx.shadowBlur = 3;
    ctx.fillStyle = "#f0a146";
    signals.forEach(function (p) {
      ctx.globalAlpha = appear * (0.5 + 0.5 * p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    });
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (this.fadeEnd > this.fadeStart) {
      var fade = ctx.createLinearGradient(0, this.fadeStart, 0, this.fadeEnd);
      fade.addColorStop(0, "rgba(0,0,0,1)");
      fade.addColorStop(0.55, "rgba(0,0,0,.45)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    }
  };
  var rafId = 0,
    lastFrame = 0,
    particleTime = 0;
  function requestFrame() {
    if (!rafId && !document.hidden) rafId = requestAnimationFrame(frame);
  }
  function frame(now) {
    rafId = 0;
    if (document.hidden) {
      lastFrame = 0;
      return;
    }
    if (lastFrame) particleTime += Math.min((now - lastFrame) / 1000, 0.06);
    lastFrame = now;
    fields.forEach(function (field) {
      if (field.visible) field.draw(particleTime);
    });
    if (
      !(reduced || still) &&
      fields.some(function (field) {
        return field.visible;
      })
    )
      requestFrame();
  }
  document.addEventListener("visibilitychange", function () {
    lastFrame = 0;
    if (!document.hidden) requestFrame();
  });
  // A field is built (and its data fetched) when its canvas is about to appear.
  function whenNearViewport(id, build) {
    var canvas = document.getElementById(id);
    var done = new Promise(function (resolve) {
      var observer = new IntersectionObserver(
        function (entries) {
          if (
            !entries.some(function (entry) {
              return entry.isIntersecting;
            })
          )
            return;
          observer.disconnect();
          loadPoints().then(function (points) {
            var field = build(canvas, points);
            fields.push(field);
            field.resize();
            if (document.body.classList.contains("ready")) field.draw(still ? 0 : 2);
            requestFrame();
            resolve(field);
          });
        },
        { rootMargin: "600px", threshold: 0 },
      );
      observer.observe(canvas);
    });
    return done;
  }
  var heroReady = whenNearViewport("hero-particles", function (canvas, points) {
    return new ParticleField(canvas, points.hero, prepared, "hero");
  });
  whenNearViewport("branch-particles", function (canvas, points) {
    return new ParticleField(canvas, points.branch, branchNetwork, "branch");
  });
  var revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 },
  );
  document.querySelectorAll(".reveal").forEach(function (element) {
    revealObserver.observe(element);
  });
  var wordObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          wordObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 1 },
  );
  document.querySelectorAll(".statement-line>span").forEach(function (word) {
    wordObserver.observe(word);
  });
  var menuToggle = document.querySelector(".menu-toggle"),
    mobileMenu = document.getElementById("mobile-menu");
  function closeMenu() {
    document.body.classList.remove("menu-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Abrir menu");
    mobileMenu.inert = true;
  }
  menuToggle.addEventListener("click", function () {
    var open = !document.body.classList.contains("menu-open");
    document.body.classList.toggle("menu-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    mobileMenu.inert = !open;
    if (open)
      requestAnimationFrame(function () {
        if (document.body.classList.contains("menu-open")) mobileMenu.querySelector("a").focus();
      });
  });
  mobileMenu.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", closeMenu);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
      closeMenu();
      menuToggle.focus();
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Tab" || !document.body.classList.contains("menu-open")) return;
    var links = mobileMenu.querySelectorAll("a, button"),
      last = links[links.length - 1];
    if (event.shiftKey && document.activeElement === links[0]) {
      event.preventDefault();
      menuToggle.focus();
    } else if (event.shiftKey && document.activeElement === menuToggle) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      menuToggle.focus();
    } else if (!event.shiftKey && document.activeElement === menuToggle) {
      event.preventDefault();
      links[0].focus();
    }
  });
  var navObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          document.querySelectorAll(".nav-links a").forEach(function (a) {
            if (a.hash === "#" + entry.target.id) a.setAttribute("aria-current", "page");
            else a.removeAttribute("aria-current");
          });
        }
      });
    },
    { rootMargin: "-10% 0px -50% 0px", threshold: 0 },
  );
  ["inicio", "modelador", "baixar"].forEach(function (id) {
    navObserver.observe(document.getElementById(id));
  });

  var initial = {
    coordinator: {
      name: "Coordenador",
      model: "",
      effort: "",
      context: "Organize o pedido, distribua as atividades e reúna as respostas dos agentes.",
    },
    dev: { name: "DEV", model: "", effort: "", context: "" },
    research: {
      name: "Pesquisa",
      model: "",
      effort: "",
      context: "Busque referências e informações relevantes nas fontes conectadas.",
    },
    qa: {
      name: "QA",
      model: "",
      effort: "",
      context: "Revise a solução, valide os requisitos e sinalize o que precisa ser ajustado.",
    },
  };
  var agents = JSON.parse(JSON.stringify(initial)),
    selected = "dev",
    runId = 0,
    running = false;
  var nameField = document.getElementById("agent-name"),
    modelField = document.getElementById("agent-model"),
    effortField = document.getElementById("agent-effort"),
    contextField = document.getElementById("agent-context");
  var status = document.getElementById("flow-status"),
    playButton = document.getElementById("play-flow");
  function setStatus(message, busy) {
    status.classList.toggle("running", !!busy);
    status.querySelector("span:last-child").textContent = message;
  }
  function selectAgent(id) {
    selected = id;
    var agent = agents[id];
    document.querySelectorAll("[data-agent]").forEach(function (node) {
      node.classList.toggle("is-selected", node.dataset.agent === id);
      node.setAttribute("aria-pressed", String(node.dataset.agent === id));
    });
    nameField.value = agent.name;
    modelField.value = agent.model;
    effortField.value = agent.effort;
    contextField.value = agent.context;
  }
  document.querySelectorAll("[data-agent]").forEach(function (node) {
    node.addEventListener("click", function () {
      selectAgent(node.dataset.agent);
      if (!running)
        setStatus(agents[selected].name + " selecionado. Edite as propriedades ao lado.", false);
    });
    node.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
  });
  [
    [nameField, "name"],
    [modelField, "model"],
    [effortField, "effort"],
    [contextField, "context"],
  ].forEach(function (pair) {
    pair[0].addEventListener("input", function () {
      agents[selected][pair[1]] = pair[0].value;
      if (pair[1] === "name") {
        var node = document.querySelector('[data-agent="' + selected + '"]');
        node.querySelector(".node-name").textContent = pair[0].value || initial[selected].name;
        node.setAttribute(
          "aria-label",
          "Selecionar agente " + (pair[0].value || initial[selected].name),
        );
      }
    });
  });
  function clearRunning() {
    document.querySelectorAll(".is-running").forEach(function (node) {
      node.classList.remove("is-running");
    });
  }
  function markAgent(id) {
    document.querySelector('[data-agent="' + id + '"]').classList.add("is-running");
    selectAgent(id);
  }
  function markEdge(id) {
    document.querySelector('[data-edge="' + id + '"]').classList.add("is-running");
  }
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  function setPlayState(isRunning) {
    running = isRunning;
    playButton.setAttribute("aria-label", isRunning ? "Parar simulação" : "Simular fluxo");
    playButton.title = isRunning ? "Parar simulação" : "Simular fluxo";
    playButton.querySelector("use").setAttribute("href", isRunning ? "#i-pause" : "#i-play");
  }
  async function simulate() {
    if (running) {
      runId++;
      clearRunning();
      setPlayState(false);
      setStatus("Simulação pausada. Você pode iniciar novamente.", false);
      return;
    }
    var id = ++runId;
    clearRunning();
    setPlayState(true);
    setStatus("Simulação: recebendo o pedido...", true);
    document.querySelector('[data-terminal="input"]').classList.add("is-running");
    await delay(550);
    if (id !== runId) return;
    markEdge("input-coordinator");
    markAgent("coordinator");
    setStatus("Coordenador: distribuindo as atividades...", true);
    await delay(850);
    if (id !== runId) return;
    clearRunning();
    markAgent("dev");
    document.querySelector('[data-agent="research"]').classList.add("is-running");
    markEdge("coordinator-dev");
    markEdge("coordinator-research");
    setStatus("DEV e Pesquisa: atividades em paralelo...", true);
    await delay(1300);
    if (id !== runId) return;
    clearRunning();
    markEdge("dev-qa");
    markEdge("research-qa");
    markAgent("qa");
    setStatus("QA: revisando a solução...", true);
    await delay(950);
    if (id !== runId) return;
    clearRunning();
    markEdge("qa-output");
    document.querySelector('[data-terminal="output"]').classList.add("is-running");
    setStatus("Simulação concluída. O pedido percorreu todo o fluxo.", false);
    setPlayState(false);
    await delay(1400);
    if (id === runId) clearRunning();
  }
  playButton.addEventListener("click", simulate);
  document.getElementById("reset-flow").addEventListener("click", function () {
    runId++;
    clearRunning();
    setPlayState(false);
    agents = JSON.parse(JSON.stringify(initial));
    document.querySelectorAll("[data-agent]").forEach(function (node) {
      node.querySelector(".node-name").textContent = agents[node.dataset.agent].name;
      node.setAttribute("aria-label", "Selecionar agente " + agents[node.dataset.agent].name);
    });
    selectAgent("dev");
    setStatus("Exemplo restaurado. Selecione um agente para explorar.", false);
  });
  function openDialog(id) {
    document.getElementById(id).showModal();
  }
  document.querySelectorAll("[data-dialog]").forEach(function (button) {
    button.addEventListener("click", function () {
      openDialog(button.dataset.dialog);
    });
  });
  document.querySelectorAll(".close-dialog").forEach(function (button) {
    button.addEventListener("click", function () {
      button.closest("dialog").close();
    });
  });
  document.querySelectorAll("dialog").forEach(function (dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        var rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dialog.close();
      }
    });
  });
  document.getElementById("show-code").addEventListener("click", function () {
    document.getElementById("flow-json").textContent = JSON.stringify(
      {
        nome: "Meu fluxo",
        tipo: "demonstracao",
        agentes: agents,
        conexoes: [
          ["Pedido", "Coordenador"],
          ["Coordenador", "DEV"],
          ["Coordenador", "Pesquisa"],
          ["DEV", "QA"],
          ["Pesquisa", "QA"],
          ["QA", "Entrega"],
        ],
      },
      null,
      2,
    );
    openDialog("code-dialog");
  });
  selectAgent("dev");
  window.__previewReady = Promise.all([document.fonts.ready, heroReady, loadPoints()]).then(
    function (results) {
      document.body.classList.add("ready");
      fields.forEach(function (field) {
        field.resize();
        field.draw(still ? 0 : 2);
      });
      requestFrame();
      return { heroPoints: results[2].hero.length, branchPoints: results[2].branch.length };
    },
  );
})();

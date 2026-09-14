(async () => {
  const REPO_BASE =
    "https://raw.githubusercontent.com/TheShadeV/appsupp_booklets/main/";

  const hostname = location.hostname.toLowerCase();
  const pathname = location.pathname;

  /*
   * ============================================================
   * HELPER ROUTES
   * ============================================================
   *
   * hostnames:
   *   One or more servers where the helper should work.
   *
   * script:
   *   Path to the helper script inside this GitHub repository.
   *
   * path:
   *   OPTIONAL.
   *   Use this when multiple helpers exist on the same server.
   *
   * Example:
   *
   * {
   *     hostnames: [
   *         "prod.example.hu",
   *         "test.example.hu",
   *         "dev.example.hu"
   *     ],
   *     path: "/ServiceRequest/",
   *     script: "hirlevel/script.js"
   * }
   */

  const routes = [
    {
      hostnames: ["scsm.tr.pte.hu", "scsm2.tr.pte.hu", "sm.pte.hu"],
      script: "hirlevel/script_min.js",
    },
    {
      hostnames: ["szemely.pte.hu"],
      script: "szemely/script_min.js",
    },
    {
      hostnames: ["ekop.pte.hu", "kitep.pte.hu"],
      script: "ekop_kitep/script_min.js",
    },
    {
      hostnames: ["tk.pte.hu"],
      script: "tk/script_min.js",
    },
    {
      hostnames: ["hirlevel.pte.hu"],
      script: "hirlevel/drupal.js",
    },
  ];

  /*
   * ============================================================
   * FIND MATCHING HELPER
   * ============================================================
   */

  const route = routes.find((route) => {
    /*
     * Check hostname.
     */
    const matchesHostname =
      Array.isArray(route.hostnames) &&
      route.hostnames.some((host) => host.toLowerCase() === hostname);

    if (!matchesHostname) {
      return false;
    }

    /*
     * If this route has a path restriction,
     * check that too.
     */
    if (route.path && !pathname.startsWith(route.path)) {
      return false;
    }

    return true;
  });

  /*
   * ============================================================
   * NO HELPER FOR THIS SITE
   * ============================================================
   */

  if (!route) {
    console.warn("[AppSupp Helper] No matching helper.", {
      hostname,
      pathname,
    });

    alert(
      "Ehhez az oldalhoz nincs Helper beállítva.\n\n" +
        "Szerver: " +
        hostname +
        "\n\n" +
        "Útvonal: " +
        pathname,
    );

    return;
  }

  /*
   * ============================================================
   * LOAD MATCHING SCRIPT
   * ============================================================
   */

  const scriptUrl = REPO_BASE + route.script + "?t=" + Date.now();

  console.log(`[AppSupp Helper] ${hostname} -> ${route.script}`);

  try {
    const response = await fetch(scriptUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const code = await response.text();

    /*
     * sourceURL makes errors easier to identify
     * in the browser developer console.
     *
     * Example:
     *
     * hirlevel/script.js:125
     *
     * instead of:
     *
     * <anonymous>:125
     */
    const sourceName = route.script.replace(/[^\w./-]/g, "_");

    (0, eval)(code + `\n//# sourceURL=${sourceName}`);

    console.log(`[AppSupp Helper] Loaded: ${route.script}`);
  } catch (error) {
    console.error(`[AppSupp Helper] Failed to load ${route.script}`, error);

    alert(
      "Helper betöltése sikertelen.\n\n" +
        "Script: " +
        route.script +
        "\n\n" +
        error,
    );
  }
})();

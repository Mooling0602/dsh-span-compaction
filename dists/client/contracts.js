/**
 * Local aliases over the DSH client services this bundle reads.
 *
 * The services are typed from the official packages rather than from
 * hand-written structural copies, so a DSH client API change fails this build
 * instead of the settings page at runtime. Every package below is a type-only
 * import: the Web app's module loader supplies the shared browser packages, so
 * nothing here is bundled or resolved at page load.
 *
 * @module dsh-span-compaction/client/contracts
 */
export {};

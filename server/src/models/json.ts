/** toJSON transform: exposes `id`, hides Mongo internals and any extra private fields. */
export const jsonTransform =
  (...hidden: string[]) =>
  (_doc: unknown, ret: object) => {
    const out = ret as Record<string, unknown>;
    out.id = String(out._id);
    delete out._id;
    delete out.__v;
    for (const key of hidden) delete out[key];
    return out;
  };

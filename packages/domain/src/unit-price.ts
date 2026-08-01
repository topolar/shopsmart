export type PackageUnit =
  "gram" | "kilogram" | "piece" | "roll" | "metre" | "millilitre" | "litre";

export type ComparisonUnit =
  "kilogram" | "100-gram" | "250-gram" | "piece" | "roll" | "metre" | "litre";

type UnitFamily = "mass" | "count-piece" | "count-roll" | "length" | "volume";

type Rational = Readonly<{
  numerator: bigint;
  denominator: bigint;
}>;

type UnitDefinition = Readonly<{
  family: UnitFamily;
  baseAmount: Rational;
}>;

const packageUnits: Readonly<Record<PackageUnit, UnitDefinition>> = {
  gram: { family: "mass", baseAmount: rational(1n) },
  kilogram: { family: "mass", baseAmount: rational(1_000n) },
  piece: { family: "count-piece", baseAmount: rational(1n) },
  roll: { family: "count-roll", baseAmount: rational(1n) },
  metre: { family: "length", baseAmount: rational(1n) },
  millilitre: { family: "volume", baseAmount: rational(1n) },
  litre: { family: "volume", baseAmount: rational(1_000n) },
};

const comparisonUnits: Readonly<Record<ComparisonUnit, UnitDefinition>> = {
  kilogram: { family: "mass", baseAmount: rational(1_000n) },
  "100-gram": { family: "mass", baseAmount: rational(100n) },
  "250-gram": { family: "mass", baseAmount: rational(250n) },
  piece: { family: "count-piece", baseAmount: rational(1n) },
  roll: { family: "count-roll", baseAmount: rational(1n) },
  metre: { family: "length", baseAmount: rational(1n) },
  litre: { family: "volume", baseAmount: rational(1_000n) },
};

export type NormalizeUnitPriceInput = Readonly<{
  packagePrice: string;
  packageQuantity: Readonly<{
    amount: string;
    unit: PackageUnit;
  }>;
  comparisonUnit: ComparisonUnit;
}>;

export type NormalizedUnitPrice = Readonly<{
  amount: string;
  unit: ComparisonUnit;
}>;

export class InvalidNormalizationInputError extends Error {
  readonly code = "INVALID_NORMALIZATION_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidNormalizationInputError";
  }
}

export class IncompatibleUnitError extends Error {
  readonly code = "INCOMPATIBLE_UNIT";

  constructor(packageUnit: PackageUnit, comparisonUnit: ComparisonUnit) {
    super(`Cannot compare package unit ${packageUnit} with ${comparisonUnit}.`);
    this.name = "IncompatibleUnitError";
  }
}

export function normalizeUnitPrice(
  input: NormalizeUnitPriceInput,
): NormalizedUnitPrice {
  const packageDefinition = packageUnits[input.packageQuantity.unit];
  const comparisonDefinition = comparisonUnits[input.comparisonUnit];

  if (packageDefinition.family !== comparisonDefinition.family) {
    throw new IncompatibleUnitError(
      input.packageQuantity.unit,
      input.comparisonUnit,
    );
  }

  const packagePriceMinor = parseMoneyToMinor(input.packagePrice);
  const declaredQuantity = parsePositiveDecimal(
    input.packageQuantity.amount,
    "package quantity",
  );
  const packageBaseQuantity = multiply(
    declaredQuantity,
    packageDefinition.baseAmount,
  );

  const resultMinorNumerator =
    packagePriceMinor *
    comparisonDefinition.baseAmount.numerator *
    packageBaseQuantity.denominator;
  const resultMinorDenominator =
    comparisonDefinition.baseAmount.denominator * packageBaseQuantity.numerator;
  const roundedMinor = divideRoundHalfUp(
    resultMinorNumerator,
    resultMinorDenominator,
  );

  return {
    amount: formatMinor(roundedMinor),
    unit: input.comparisonUnit,
  };
}

function rational(numerator: bigint, denominator = 1n): Rational {
  return { numerator, denominator };
}

function multiply(left: Rational, right: Rational): Rational {
  return {
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  };
}

function parseMoneyToMinor(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    throw new InvalidNormalizationInputError(
      "Package price must be a non-negative decimal with at most two fraction digits.",
    );
  }

  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const minor = whole * 100n + BigInt(fraction || "0");

  if (minor <= 0n) {
    throw new InvalidNormalizationInputError(
      "Package price must be greater than zero.",
    );
  }

  return minor;
}

function parsePositiveDecimal(value: string, fieldName: string): Rational {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw new InvalidNormalizationInputError(
      `${fieldName} must be a decimal with at most six fraction digits.`,
    );
  }

  const fraction = match[2] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  const numerator =
    BigInt(match[1] ?? "0") * denominator + BigInt(fraction || "0");

  if (numerator <= 0n) {
    throw new InvalidNormalizationInputError(
      `${fieldName} must be greater than zero.`,
    );
  }

  return rational(numerator, denominator);
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function formatMinor(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

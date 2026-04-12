import AuthConfig from "../models/AuthConfig.js";
import DomainAuthConfig from "../models/DomainAuthConfig.js";
import Domain from "../models/Domain.js";

export const DEFAULT_AUTH_CONFIG = {
  loginMethods: {
    emailPassword: true,
    googleSSO: false,
    otpLogin: false,
  },
  passwordPolicy: {
    minLength: 8,
    requireUppercase: true,
    requireNumbers: true,
    requireSpecialChar: false,
    expiryDays: 90,
  },
  mfa: {
    enabled: false,
    methods: [],
  },
  sessionRules: {
    timeoutMinutes: 60,
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 15,
  },
};

export const resolveAuthConfig = async (tenantId, domainId) => {
  const resolved = await resolveAuthConfigWithSource(tenantId, domainId);
  return resolved.config;
};

const normalizeObjectId = (value) => (value ? value.toString() : null);

const findNearestDomainAuthConfig = async (tenantId, domainId) => {
  if (!domainId) {
    return null;
  }

  let cursorDomainId = normalizeObjectId(domainId);

  while (cursorDomainId) {
    const currentObjectId = cursorDomainId;
    const config = await DomainAuthConfig.findOne({
      tenantId,
      domainId: currentObjectId,
    });

    if (config) {
      return {
        config,
        sourceType: "domain",
        sourceDomainId: config.domainId,
      };
    }

    const currentDomain = await Domain.findOne({
      _id: currentObjectId,
      tenantId,
    }).select("parentDomainId");

    if (!currentDomain?.parentDomainId) {
      break;
    }

    cursorDomainId = normalizeObjectId(currentDomain.parentDomainId);
  }

  return null;
};

export const resolveAuthConfigWithSource = async (tenantId, domainId) => {
  const domainMatch = await findNearestDomainAuthConfig(tenantId, domainId);

  if (domainMatch) {
    return domainMatch;
  }

  let tenantConfig = await AuthConfig.findOne({ tenantId, domainId: null });

  if (!tenantConfig) {
    tenantConfig = await AuthConfig.create({
      tenantId,
      domainId: null,
      ...DEFAULT_AUTH_CONFIG,
    });
  }

  return {
    config: tenantConfig,
    sourceType: "tenant",
    sourceDomainId: null,
  };
};

export const mapAuthConfig = (config, source = {}) => ({
  tenantId: config.tenantId.toString(),
  domainId: config.domainId?.toString() ?? null,
  sourceType: source.sourceType ?? null,
  sourceDomainId: source.sourceDomainId?.toString() ?? null,
  passwordEnabled: config.loginMethods.emailPassword,
  ssoEnabled: config.loginMethods.googleSSO,
  otpEnabled: config.loginMethods.otpLogin,
  mfaEnabled: config.mfa.enabled,
  passwordPolicy: {
    minLength: config.passwordPolicy.minLength,
    requireUppercase: config.passwordPolicy.requireUppercase,
    requireNumbers: config.passwordPolicy.requireNumbers,
    requireSpecialChars: config.passwordPolicy.requireSpecialChar,
    expiryDays: config.passwordPolicy.expiryDays,
  },
  sessionTimeoutMinutes: config.sessionRules.timeoutMinutes,
  maxLoginAttempts: config.sessionRules.maxLoginAttempts,
  lockoutDurationMinutes: config.sessionRules.lockoutDurationMinutes,
});

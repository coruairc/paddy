import Foundation
import OpenClawProtocol

public struct OpenClawChatAgentChoice: Codable, Identifiable, Sendable, Hashable {
    public let id: String
    public let name: String?
    public let emoji: String?
    public let workspaceGit: Bool?

    public init(id: String, name: String? = nil, emoji: String? = nil, workspaceGit: Bool? = nil) {
        self.id = id
        self.name = Self.normalizedName(name)
        self.emoji = Self.textAvatar(emoji)
        self.workspaceGit = workspaceGit
    }

    public var displayName: String {
        Self.normalizedName(self.name) ?? String(localized: "Assistant")
    }

    public var avatarText: String {
        Self.textAvatar(self.emoji) ?? String(self.displayName.prefix(1)).uppercased()
    }

    static func normalizedName(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        // Match normalizeAssistantIdentity's UTF-16 bound without splitting a surrogate pair.
        var units = Array(value.utf16.prefix(50))
        if let last = units.last, (0xD800...0xDBFF).contains(last) { units.removeLast() }
        return String(decoding: units, as: UTF16.self)
    }

    static func textAvatar(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty, value.utf16.count <= 64,
              !value.contains("\r"), !value.contains("\n"),
              !value.hasPrefix("/"),
              value.range(of: "^[a-z][a-z0-9+.-]*:", options: [.regularExpression, .caseInsensitive]) == nil
        else { return nil }
        // Image data and Gateway paths need an authenticated image loader; never render them as text.
        return value
    }

    func resolving(_ identity: AgentIdentityResult?) -> Self {
        guard let identity, identity.agentid == self.id else { return self }
        return Self(
            id: self.id,
            name: self.name ?? identity.name,
            emoji: self.emoji ?? Self.textAvatar(identity.emoji) ?? Self.textAvatar(identity.avatar),
            workspaceGit: self.workspaceGit)
    }
}

public struct OpenClawChatAgentsListResponse: Codable, Sendable, Equatable {
    public let defaultId: String
    public let agents: [OpenClawChatAgentChoice]
    public let sessionRoutingContract: String?

    public init(
        defaultId: String,
        agents: [OpenClawChatAgentChoice],
        sessionRoutingContract: String? = nil)
    {
        self.defaultId = defaultId
        self.agents = agents
        self.sessionRoutingContract = sessionRoutingContract
    }

    /// Resolved identities live in the caller's existing catalog, and refresh with its roster.
    /// Both callbacks must retain the same Gateway connection for the entire load.
    public static func load(
        request: @escaping @Sendable (OpenClawChatGatewayRequest) async throws -> Data,
        isCurrent: @Sendable () async -> Bool) async throws -> Self
    {
        let data = try await request(OpenClawChatGatewayRequests.agentsList())
        let catalog = try OpenClawChatGatewayPayloadCodec.decodeAgentsList(data)
        let agents = await withTaskGroup(of: (Int, OpenClawChatAgentChoice).self) { group in
            for (index, agent) in catalog.agents.enumerated() {
                group.addTask {
                    let data = try? await request(OpenClawChatGatewayRequests.agentIdentity(agentID: agent.id))
                    let identity = data.flatMap { try? JSONDecoder().decode(AgentIdentityResult.self, from: $0) }
                    return (index, agent.resolving(identity))
                }
            }
            var agents = catalog.agents
            for await (index, agent) in group {
                agents[index] = agent
            }
            return agents
        }
        try Task.checkCancellation()
        // An optional identity failure must not hide the roster, but a retired connection must.
        guard await isCurrent() else { throw CancellationError() }
        return Self(
            defaultId: catalog.defaultId,
            agents: agents,
            sessionRoutingContract: catalog.sessionRoutingContract)
    }
}

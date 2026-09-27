import Foundation
import OpenClawChatUI
import OpenClawProtocol
import Testing

struct ChatGatewayAgentCatalogTests {
    @Test func `unnamed agents use the assistant identity fallback`() throws {
        let data = Data(#"{"defaultId":"main","mainKey":"main","scope":"per-sender","agents":[{"id":"main"}]}"#.utf8)
        let catalog = try OpenClawChatGatewayPayloadCodec.decodeAgentsList(data)
        #expect(catalog.agents.first?.displayName == "Assistant")
    }

    @Test func `identity requests target the listed agent without a session alias`() {
        let request = OpenClawChatGatewayRequests.agentIdentity(agentID: " research ")
        #expect(request.method == "agent.identity.get")
        #expect(request.params == ["agentId": AnyCodable("research")])
    }

    @Test(arguments: [
        (" ", "Assistant"),
        (" Research ", "Research"),
        (String(repeating: "x", count: 51), String(repeating: "x", count: 50)),
        (String(repeating: "x", count: 49) + "🦞", String(repeating: "x", count: 49)),
        (String(repeating: "🦞", count: 26), String(repeating: "🦞", count: 25)),
    ])
    func `names match the web normalization bound`(name: String, expected: String) {
        #expect(OpenClawChatAgentChoice(id: "main", name: name).displayName == expected)
    }

    @Test(arguments: [
        (" 🦞 ", Optional("🦞")),
        ("PS", Optional("PS")),
        (String(repeating: "x", count: 64), Optional(String(repeating: "x", count: 64))),
        (String(repeating: "🦞", count: 33), nil),
        ("A\nB", nil),
        ("A\rB", nil),
        ("data:image/png;base64,YQ==", nil),
        ("/avatar/main", nil),
        ("//example.test/avatar.png", nil),
        ("https://example.test/avatar.png", nil),
        ("file:///avatar.png", nil),
        ("blob:avatar", nil),
    ])
    func `text avatars remain bounded and never render image locations as glyphs`(
        avatar: String,
        expected: String?)
    {
        let agent = OpenClawChatAgentChoice(id: "main", name: "Research", emoji: avatar)
        #expect(agent.emoji == expected)
        #expect(agent.avatarText == (expected ?? "R"))
    }

    @Test func `catalog hydration preserves configured identity routing and roster order`() async throws {
        let catalog = try await OpenClawChatAgentsListResponse.load(request: { request in
            if request.method == "agents.list" {
                #expect(request.params.isEmpty)
                return Data(
                    #"{"defaultId":"main","mainKey":"inbox","scope":"global","agents":[{"id":"main"},{"id":"ops","name":" Operations ","identity":{"name":"Ignored","emoji":"🛠️"},"workspaceGit":true},{"id":"research","name":" ","identity":{"name":" Research ","avatar":"RS"}},{"id":"system","kind":"system"}]}"#
                        .utf8)
            }
            #expect(request.method == "agent.identity.get")
            let id = try #require(request.params["agentId"]?.value as? String)
            #expect(["main", "ops", "research"].contains(id))
            return try JSONEncoder().encode(AgentIdentityResult(
                agentid: id, name: "Assistant", namesource: "default", avatar: "A"))
        }, isCurrent: { true })

        #expect(catalog.defaultId == "main")
        #expect(catalog.sessionRoutingContract == "global|inbox|main")
        #expect(catalog.agents.map(\.id) == ["main", "ops", "research"])
        #expect(catalog.agents.map(\.displayName) == ["Assistant", "Operations", "Research"])
        #expect(catalog.agents.map(\.avatarText) == ["A", "🛠️", "RS"])
        #expect(catalog.agents[1].workspaceGit == true)
    }

    @Test func `identity refreshes replace prior names and isolate failed or mismatched identities`() async throws {
        for name in ["First identity", "Updated identity"] {
            let catalog = try await OpenClawChatAgentsListResponse.load(request: { request in
                if request.method == "agents.list" {
                    return Data(
                        #"{"defaultId":"main","mainKey":"main","scope":"per-sender","agents":[{"id":"main"},{"id":"offline","name":"Configured"},{"id":"mismatch"}]}"#
                            .utf8)
                }
                let id = try #require(request.params["agentId"]?.value as? String)
                if id == "offline" { throw URLError(.notConnectedToInternet) }
                return try JSONEncoder().encode(AgentIdentityResult(
                    agentid: id == "mismatch" ? "another-agent" : id,
                    name: name, avatar: "AB", emoji: "🦞"))
            }, isCurrent: { true })
            #expect(catalog.agents.map(\.displayName) == [name, "Configured", "Assistant"])
            #expect(catalog.agents.map(\.avatarText) == ["🦞", "C", "A"])
        }
    }

    @Test func `a retired connection cannot publish a partially hydrated catalog`() async {
        await #expect(throws: CancellationError.self) {
            try await OpenClawChatAgentsListResponse.load(request: { request in
                if request.method == "agents.list" {
                    return Data(#"{"defaultId":"main","mainKey":"main","scope":"per-sender","agents":[{"id":"main"}]}"#
                        .utf8)
                }
                throw CancellationError()
            }, isCurrent: { false })
        }
    }

    @Test func `scoped legacy session rows retain their owner without rewriting global keys`() throws {
        let data = Data(#"{"sessions":[{"key":"global"},{"key":"agent:research:global"}]}"#.utf8)
        let result = try OpenClawChatGatewayPayloadCodec.decodeSessionsList(data, agentID: "main")
        #expect(result.sessions.map(\.key) == ["global", "agent:research:global"])
        #expect(result.sessions.map(\.agentId) == ["main", "research"])
    }

    @Test(arguments: ["[]", #"[{"id":"system","kind":"system"}]"#])
    func `empty selectable rosters preserve the server default`(agents: String) throws {
        let data = Data("""
        {"defaultId":"system","mainKey":"main","scope":"per-sender","agents":\(agents)}
        """.utf8)

        #expect(try OpenClawChatGatewayPayloadCodec.decodeAgentsList(data) ==
            OpenClawChatAgentsListResponse(
                defaultId: "system",
                agents: [],
                sessionRoutingContract: "per-sender|main|system"))
    }

    @Test func `agent navigation retains identity and configured main routing`() throws {
        let data = Data(
            #"{"defaultId":"ops","mainKey":"inbox","scope":"global","agents":[{"id":"ops","name":"Operations","identity":{"emoji":"🛠️"},"workspaceGit":true}]}"#
                .utf8)

        let catalog = try OpenClawChatGatewayPayloadCodec.decodeAgentsList(data)

        #expect(catalog.sessionRoutingContract == "global|inbox|ops")
        #expect(catalog.agents == [
            OpenClawChatAgentChoice(id: "ops", name: "Operations", emoji: "🛠️", workspaceGit: true),
        ])
    }

    @Test(arguments: [
        #"{"defaultId":"main","scope":"per-sender","agents":[]}"#,
        #"{"defaultId":"main","mainKey":"main","agents":[]}"#,
        #"{"defaultId":"main","mainKey":"main","scope":"per-sender","agents":[{"id":"main","kind":"unknown"}]}"#,
    ])
    func `malformed gateway rosters retain protocol decoding failures`(payload: String) {
        #expect(throws: DecodingError.self) {
            try OpenClawChatGatewayPayloadCodec.decodeAgentsList(Data(payload.utf8))
        }
    }
}

import SwiftUI
import WidgetKit

// Three shortcuts and nothing else. A widget shows outside the lock, so this reads nothing and stores
// nothing, and each shortcut only opens the app, which goes through the lock before it acts.
@main
struct HubWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "HubWidget", provider: Provider()) { _ in
            HubWidgetView()
        }
        .configurationDisplayName("LocalHub")
        .description("Shortcuts into LocalHub. They go through the lock if it's on.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct Entry: TimelineEntry {
    let date: Date
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: Date())], policy: .never))
    }
}

struct HubWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content.modifier(WidgetBackground())
    }

    // A small widget is one tap target on iOS, so it opens the Hub. A medium one has room for all three.
    @ViewBuilder private var content: some View {
        if family == .systemSmall {
            VStack(spacing: 8) {
                Image(systemName: "house")
                    .font(.title2)
                Text("Open Hub")
                    .font(.headline)
            }
            .widgetURL(URL(string: "localhub://action/open"))
        } else {
            HStack(spacing: 8) {
                shortcut("Open Hub", symbol: "house", action: "open")
                shortcut("Message", symbol: "square.and.pencil", action: "compose")
                shortcut("Status", symbol: "circle.dotted", action: "status")
            }
        }
    }

    private func shortcut(_ title: String, symbol: String, action: String) -> some View {
        Link(destination: URL(string: "localhub://action/\(action)")!) {
            VStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.title3)
                Text(title)
                    .font(.footnote)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// The system asks for this from iOS 17, and it doesn't exist before that.
struct WidgetBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) { Color(.systemBackground) }
        } else {
            content
        }
    }
}

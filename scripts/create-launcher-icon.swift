import AppKit

let output = CommandLine.arguments[1]
let size = CGFloat(CommandLine.arguments.dropFirst(2).first.flatMap(Double.init) ?? 2048)
let rect = NSRect(x: 0, y: 0, width: size, height: size)
let image = NSImage(size: rect.size)
let scale = size / 1024

func r(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> NSRect {
  NSRect(x: x * scale, y: y * scale, width: width * scale, height: height * scale)
}

func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
  CGPoint(x: x * scale, y: y * scale)
}

func c(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> NSColor {
  NSColor(red: red, green: green, blue: blue, alpha: alpha)
}

image.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high

let shadow = NSShadow()
shadow.shadowOffset = NSSize(width: 0, height: -18 * scale)
shadow.shadowBlurRadius = 42 * scale
shadow.shadowColor = NSColor.black.withAlphaComponent(0.34)
NSGraphicsContext.saveGraphicsState()
shadow.set()

let tile = NSBezierPath(roundedRect: r(64, 64, 896, 896), xRadius: 206 * scale, yRadius: 206 * scale)
let tileGradient = NSGradient(colors: [
  c(0.12, 0.17, 0.23),
  c(0.05, 0.07, 0.10),
])!
tileGradient.draw(in: tile, angle: 90)
NSGraphicsContext.restoreGraphicsState()

let rim = NSBezierPath(roundedRect: r(64, 64, 896, 896), xRadius: 206 * scale, yRadius: 206 * scale)
c(0.27, 0.34, 0.43, 0.78).setStroke()
rim.lineWidth = 7 * scale
rim.stroke()

let glow = NSBezierPath(ovalIn: r(156, 170, 712, 660))
c(0.55, 0.68, 0.80, 0.10).setFill()
glow.fill()

let terminalRect = r(156, 180, 712, 664)
let terminal = NSBezierPath(roundedRect: terminalRect, xRadius: 74 * scale, yRadius: 74 * scale)
c(0.015, 0.018, 0.022, 0.99).setFill()
terminal.fill()
c(0.28, 0.32, 0.38, 1).setStroke()
terminal.lineWidth = 7 * scale
terminal.stroke()

let titleBar = NSBezierPath(roundedRect: r(156, 724, 712, 120), xRadius: 74 * scale, yRadius: 74 * scale)
c(0.09, 0.10, 0.12, 1).setFill()
titleBar.fill()

for (index, color) in [
  c(1.0, 0.38, 0.36),
  c(1.0, 0.80, 0.29),
  c(0.38, 0.82, 0.44),
].enumerated() {
  color.setFill()
  NSBezierPath(ovalIn: r(236 + CGFloat(index) * 62, 768, 34, 34)).fill()
}

func strokePath(_ points: [CGPoint], width: CGFloat, color: NSColor) {
  guard let first = points.first else { return }
  let path = NSBezierPath()
  path.move(to: first)
  for point in points.dropFirst() {
    path.line(to: point)
  }
  path.lineCapStyle = .round
  path.lineJoinStyle = .round
  path.lineWidth = width * scale
  color.setStroke()
  path.stroke()
}

func drawPrompt(y: CGFloat, active: Bool = false) {
  let color = active ? c(0.78, 0.92, 1.0) : c(0.55, 0.68, 0.78)
  strokePath([p(278, y + 36), p(334, y), p(278, y - 36)], width: 18, color: color)
  let cursorX = 392
  let cursorWidth = active ? 220 : 150
  color.setFill()
  NSBezierPath(roundedRect: r(CGFloat(cursorX), y - 11, CGFloat(cursorWidth), 22), xRadius: 11 * scale, yRadius: 11 * scale).fill()
}

func drawFaintTextLine(x: CGFloat, y: CGFloat, width: CGFloat) {
  c(0.24, 0.33, 0.40, 0.82).setFill()
  NSBezierPath(roundedRect: r(x, y - 9, width, 18), xRadius: 9 * scale, yRadius: 9 * scale).fill()
}

drawPrompt(y: 588, active: false)
drawFaintTextLine(x: 560, y: 588, width: 170)

drawPrompt(y: 448, active: false)
drawFaintTextLine(x: 548, y: 448, width: 232)

drawPrompt(y: 308, active: true)

let scanLine = NSBezierPath(roundedRect: r(206, 678, 612, 3), xRadius: 1.5 * scale, yRadius: 1.5 * scale)
c(0.82, 0.91, 1.0, 0.08).setFill()
scanLine.fill()

let bottomGlow = NSBezierPath(ovalIn: r(240, 196, 544, 92))
c(0.56, 0.72, 0.90, 0.10).setFill()
bottomGlow.fill()

/*
 Keep the symbol terminal-first: the three prompts intentionally replace the
 previous single-line >_ mark.
 */

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let data = rep.representation(using: .png, properties: [:]) else {
  fatalError("failed to render icon")
}
try data.write(to: URL(fileURLWithPath: output))

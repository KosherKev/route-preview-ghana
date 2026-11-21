// Generates a SYNTHETIC test-pattern clip (colour bars, a moving marker, a frame counter) with the system AVFoundation,
// because ffmpeg is not installed here. It is not imagery of any place. Output goes OUTSIDE the repo.
//
//   swift tool/make_test_clip.swift <out.mp4> [seconds=8] [fps=24]
import AVFoundation
import CoreGraphics
import CoreText
import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: make_test_clip.swift <out.mp4> [seconds] [fps]"); exit(2) }
let out = URL(fileURLWithPath: args[1])
let seconds = args.count > 2 ? Double(args[2]) ?? 8 : 8
let fps = args.count > 3 ? Int32(args[3]) ?? 24 : 24
let width = 720, height = 1280 // portrait, like a phone screen

try? FileManager.default.removeItem(at: out)
try FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let bars: [(CGFloat, CGFloat, CGFloat)] = [(1, 1, 1), (1, 1, 0), (0, 1, 1), (0, 1, 0), (1, 0, 1), (1, 0, 0), (0, 0, 1)]
let total = Int(seconds * Double(fps))
for frame in 0..<total {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
    guard let buf = pb else { fatalError("no pixel buffer") }
    CVPixelBufferLockBaseAddress(buf, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: width, height: height, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    let bw = CGFloat(width) / CGFloat(bars.count)
    for (i, c) in bars.enumerated() {
        ctx.setFillColor(red: c.0 * 0.85, green: c.1 * 0.85, blue: c.2 * 0.85, alpha: 1)
        ctx.fill(CGRect(x: CGFloat(i) * bw, y: 0, width: bw, height: CGFloat(height)))
    }
    // A bright horizontal marker sweeping down the picture: easy to see the clip is moving and where it is.
    let progress = CGFloat(frame) / CGFloat(total)
    ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 0.9)
    ctx.fill(CGRect(x: 0, y: CGFloat(height) * (1 - progress) - 8, width: CGFloat(width), height: 16))
    let label = String(format: "SYNTHETIC TEST CLIP  t=%.2fs  frame %d", Double(frame) / Double(fps), frame)
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 34, nil)
    let attr = NSAttributedString(string: label, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font, NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 0, green: 0, blue: 0, alpha: 1)])
    ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 0.85)
    ctx.fill(CGRect(x: 10, y: CGFloat(height) / 2 - 30, width: CGFloat(width) - 20, height: 60))
    ctx.textPosition = CGPoint(x: 24, y: CGFloat(height) / 2 - 12)
    CTLineDraw(CTLineCreateWithAttributedString(attr), ctx)
    CVPixelBufferUnlockBaseAddress(buf, [])
    adaptor.append(buf, withPresentationTime: CMTime(value: Int64(frame), timescale: fps))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
print(writer.status == .completed ? "wrote \(out.path)" : "failed: \(String(describing: writer.error))")

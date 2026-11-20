import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';

class FeedItem {
  final String id;
  final String title;
  final String category;
  final String source;
  final String summary;
  final List<String> takeaways;
  final String readTime;
  final String date;
  final String url;
  final String level;

  const FeedItem({
    required this.id,
    required this.title,
    required this.category,
    required this.source,
    required this.summary,
    required this.takeaways,
    required this.readTime,
    required this.date,
    required this.url,
    this.level = 'Deep Dive',
  });
}

class FeedsScreen extends StatefulWidget {
  const FeedsScreen({super.key});

  @override
  State<FeedsScreen> createState() => _FeedsScreenState();
}

class _FeedsScreenState extends State<FeedsScreen> {
  String _selectedCategory = 'All';
  String _query = '';
  final Set<String> _bookmarked = {};
  final Set<String> _expanded = {};

  static const _categories = [
    'All',
    'AI & Research',
    'Tech & Dev',
    'Space & Science',
    'Web & Frontend',
    'Backend & Systems',
    'Databases',
    'Mobile & Android',
    'CS Concepts',
    'Saved',
  ];

  static const List<FeedItem> _allFeeds = [
    FeedItem(
      id: 'ai-transformer-attention',
      title: 'Attention Mechanisms in Large Language Models: From Scaled Dot-Product to FlashAttention-3',
      category: 'AI & Research',
      source: 'arXiv / Stanford AI Lab',
      summary: 'A mathematical and architectural breakdown of self-attention complexity, memory bandwidth bottlenecks in GPUs, and how FlashAttention optimizes SRAM tiles to achieve 3-5x throughput.',
      takeaways: [
        'Standard attention requires O(N²) memory bandwidth due to intermediate NxN attention matrices.',
        'FlashAttention tiles query, key, and value vectors into high-speed GPU SRAM, avoiding HBM round-trips.',
        'FlashAttention-3 leverages asynchronous Tensor Core hardware operations on modern Hopper architectures.',
      ],
      readTime: '8 min read',
      date: 'Today',
      url: 'https://arxiv.org/abs/2307.08691',
      level: 'Research Paper',
    ),
    FeedItem(
      id: 'db-lsm-vs-btree',
      title: 'LSM-Trees vs B+ Trees: Write Amplification and Storage Engine Tradeoffs',
      category: 'Databases',
      source: 'Database Systems Architecture',
      summary: 'Comparative analysis of RocksDB/Cassandra log-structured merge trees against PostgreSQL/InnoDB B+ trees for write-intensive workloads versus point-read low latency.',
      takeaways: [
        'B+ trees provide predictable O(log B N) reads with localized page cache hits.',
        'LSM trees turn random writes into sequential appends via MemTable and write-ahead log (WAL).',
        'Compaction strategies (leveled vs size-tiered) directly balance space amplification vs read amplification.',
      ],
      readTime: '6 min read',
      date: 'Yesterday',
      url: 'https://en.wikipedia.org/wiki/Log-structured_merge-tree',
      level: 'Concept',
    ),
    FeedItem(
      id: 'backend-raft-consensus',
      title: 'The Raft Consensus Algorithm: Leader Election and Replicated State Machines Explained',
      category: 'Backend & Systems',
      source: 'Distributed Systems Journal',
      summary: 'Understand quorum-based consensus, randomized split-vote timers, log replication invariant safety checks, and joint consensus configuration changes.',
      takeaways: [
        'Leader election uses randomized heartbeats (150-300ms) to prevent split-brain vote stalemates.',
        'Logs are strictly monotonic: entries committed by the majority are guaranteed to survive leader crashes.',
        'Raft guarantees state machine safety by ensuring a candidate with stale logs can never win an election.',
      ],
      readTime: '10 min read',
      date: '2 days ago',
      url: 'https://raft.github.io/',
      level: 'Deep Dive',
    ),
    FeedItem(
      id: 'space-jwst-redshift',
      title: 'James Webb Space Telescope Uncovers Galaxy Candidates at Redshift z > 14',
      category: 'Space & Science',
      source: 'NASA / ESA Astrophysics',
      summary: 'Observations from JWST NIRCam reveal early universe stellar populations forming merely 300 million years after the Big Bang, challenging standard primordial star formation models.',
      takeaways: [
        'High redshift (z > 14) stretches ultraviolet light into infrared wavelengths detectable only by NIRCam.',
        'Spectroscopic confirmation reveals metallicity ratios indicating early supermassive black hole seeds.',
        'Revises cosmological simulations regarding cosmic reionization epochs.',
      ],
      readTime: '5 min read',
      date: '2 days ago',
      url: 'https://www.nasa.gov/mission/webb-space-telescope/',
      level: 'Research Paper',
    ),
    FeedItem(
      id: 'cs-zero-knowledge-snarks',
      title: 'Zero-Knowledge Proofs: How zk-SNARKs and Plonk Verify Computation Without Revealing Secrets',
      category: 'CS Concepts',
      source: 'Cryptography & Theoretical CS',
      summary: 'Interactive and non-interactive zero-knowledge proofs explained through arithmetic circuits, polynomial commitments (KZG), and elliptic curve pairings.',
      takeaways: [
        'Computations are expressed as R1CS (Rank-1 Constraint Systems) or custom PLONK gates.',
        'The Prover evaluates polynomials at secret evaluation points using elliptic curve homomorphic encryption.',
        'The Verifier checks proof validity in sub-second time without learning witness data.',
      ],
      readTime: '12 min read',
      date: '3 days ago',
      url: 'https://zcash.github.io/halo2/',
      level: 'Deep Dive',
    ),
    FeedItem(
      id: 'web-wasm-gc-thread',
      title: 'WebAssembly GC and Multi-Threading: Native Speed on the Modern Web Platform',
      category: 'Web & Frontend',
      source: 'Web Standards & V8 Team',
      summary: 'How WasmGC enables garbage-collected languages (Dart, Kotlin, Java) to run without bundling heavy runtime VMs, utilizing browser memory management directly.',
      takeaways: [
        'WasmGC passes object references to the host browser garbage collector, preventing duplicate heaps.',
        'SharedArrayBuffer and WebAssembly threads enable true parallel processing in Web Workers.',
        'Direct DOM interop avoids serialization overhead for 60fps canvas and UI pipelines.',
      ],
      readTime: '7 min read',
      date: '4 days ago',
      url: 'https://webassembly.org/',
      level: 'Concept',
    ),
    FeedItem(
      id: 'android-art-profile-guided',
      title: 'Android ART Runtime & Profile-Guided Compilation (PGO): App Startup Optimization',
      category: 'Mobile & Android',
      source: 'Android Developers Blog',
      summary: 'Deep dive into Android Runtime (ART) dex2oat compiler, baseline profiles, ahead-of-time (AOT) compilation, and reducing app launch latency by up to 40%.',
      takeaways: [
        'Baseline profiles pre-compile critical execution paths before first app launch via Google Play.',
        'Cloud profiles aggregate user trace data across fleet devices to guide JIT warmup heuristics.',
        'Reduces frame jank during cold starts by avoiding runtime bytecode interpretation.',
      ],
      readTime: '6 min read',
      date: '5 days ago',
      url: 'https://developer.android.com/topic/performance/baselineprofiles/overview',
      level: 'Deep Dive',
    ),
    FeedItem(
      id: 'tech-ebpf-linux-kernel',
      title: 'eBPF in Modern Linux: Safe Kernel Space Programmability Without Modifying Core Modules',
      category: 'Tech & Dev',
      source: 'Linux Systems & Cloud Native',
      summary: 'Extended Berkeley Packet Filter (eBPF) allows verified sandboxed bytecode execution directly inside the Linux kernel for observability, low-latency networking, and security auditing.',
      takeaways: [
        'In-kernel in-flight verifier guarantees bytecode safety (no infinite loops or unprivileged memory access).',
        'eBPF maps provide lock-free shared memory between kernel space probes and user space agents.',
        'Powers high-performance packet routing (XDP) capable of handling millions of packets per second.',
      ],
      readTime: '9 min read',
      date: '6 days ago',
      url: 'https://ebpf.io/',
      level: 'Deep Dive',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final filtered = _allFeeds.where((f) {
      if (_selectedCategory == 'Saved') {
        if (!_bookmarked.contains(f.id)) return false;
      } else if (_selectedCategory != 'All' && f.category != _selectedCategory) {
        return false;
      }
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      return f.title.toLowerCase().contains(q) ||
          f.summary.toLowerCase().contains(q) ||
          f.source.toLowerCase().contains(q);
    }).toList();

    return Scaffold(
      backgroundColor: WebDeckTheme.background,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: WebDeckTheme.primary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: WebDeckTheme.primary.withValues(alpha: 0.3),
                      ),
                    ),
                    child: const Icon(Icons.school, color: WebDeckTheme.primary, size: 20),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Learning Feeds',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: WebDeckTheme.textPrimary,
                          ),
                        ),
                        Text(
                          'High-signal tech, science, engineering & research concepts',
                          style: TextStyle(
                            fontSize: 12,
                            color: WebDeckTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Search Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
              child: TextField(
                style: const TextStyle(fontSize: 13, color: WebDeckTheme.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Search concepts, research papers, topics…',
                  hintStyle: const TextStyle(color: WebDeckTheme.textSecondary, fontSize: 13),
                  prefixIcon: const Icon(Icons.search, size: 18, color: WebDeckTheme.textSecondary),
                  suffixIcon: _query.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, size: 16),
                          onPressed: () => setState(() => _query = ''),
                        )
                      : null,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  filled: true,
                  fillColor: WebDeckTheme.surface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: WebDeckTheme.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: WebDeckTheme.border),
                  ),
                ),
                onChanged: (v) => setState(() => _query = v.trim()),
              ),
            ),

            // Category Filter Pills
            SizedBox(
              height: 46,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                scrollDirection: Axis.horizontal,
                itemCount: _categories.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (ctx, i) {
                  final cat = _categories[i];
                  final isSelected = _selectedCategory == cat;
                  return ChoiceChip(
                    label: Text(
                      cat == 'Saved' ? '★ Saved (${_bookmarked.length})' : cat,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                        color: isSelected ? Colors.white : WebDeckTheme.textSecondary,
                      ),
                    ),
                    selected: isSelected,
                    selectedColor: WebDeckTheme.primary,
                    backgroundColor: WebDeckTheme.surface,
                    showCheckmark: false,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: BorderSide(
                        color: isSelected ? WebDeckTheme.primary : WebDeckTheme.border,
                      ),
                    ),
                    onSelected: (_) => setState(() => _selectedCategory = cat),
                  );
                },
              ),
            ),

            const Divider(height: 1, color: WebDeckTheme.border),

            // Articles List
            Expanded(
              child: filtered.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _selectedCategory == 'Saved' ? Icons.bookmark_border : Icons.article_outlined,
                            size: 40,
                            color: WebDeckTheme.textSecondary,
                          ),
                          const SizedBox(height: 10),
                          Text(
                            _selectedCategory == 'Saved'
                                ? 'No saved articles yet. Bookmark feeds to read offline!'
                                : 'No learning feeds found for this filter.',
                            style: const TextStyle(color: WebDeckTheme.textSecondary, fontSize: 13),
                          ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(20),
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 14),
                      itemBuilder: (ctx, i) {
                        final item = filtered[i];
                        final isBookmarked = _bookmarked.contains(item.id);
                        final isExpanded = _expanded.contains(item.id);

                        return Container(
                          decoration: BoxDecoration(
                            color: WebDeckTheme.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: WebDeckTheme.border),
                          ),
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Source & Category & Level
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: WebDeckTheme.primary.withValues(alpha: 0.15),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      item.category,
                                      style: const TextStyle(
                                        color: WebDeckTheme.primary,
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: WebDeckTheme.surfaceSubtle,
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(color: WebDeckTheme.border),
                                    ),
                                    child: Text(
                                      item.level,
                                      style: const TextStyle(
                                        color: WebDeckTheme.textSecondary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ),
                                  const Spacer(),
                                  Text(
                                    '${item.readTime} · ${item.date}',
                                    style: const TextStyle(
                                      color: WebDeckTheme.textSecondary,
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),

                              // Title
                              Text(
                                item.title,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: WebDeckTheme.textPrimary,
                                  height: 1.35,
                                ),
                              ),
                              const SizedBox(height: 6),

                              // Source
                              Text(
                                'Source: ${item.source}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: WebDeckTheme.textSecondary,
                                  fontStyle: FontStyle.italic,
                                ),
                              ),
                              const SizedBox(height: 10),

                              // Summary
                              Text(
                                item.summary,
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: WebDeckTheme.textSecondary,
                                  height: 1.45,
                                ),
                              ),

                              // Key Takeaways expandable
                              if (isExpanded) ...[
                                const SizedBox(height: 12),
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: WebDeckTheme.surfaceSubtle,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: WebDeckTheme.border),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Row(
                                        children: [
                                          Icon(Icons.lightbulb_outline, size: 15, color: WebDeckTheme.accentGreen),
                                          SizedBox(width: 6),
                                          Text(
                                            'Key Learnings & Takeaways:',
                                            style: TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.w700,
                                              color: WebDeckTheme.textPrimary,
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 8),
                                      for (final point in item.takeaways)
                                        Padding(
                                          padding: const EdgeInsets.only(bottom: 6),
                                          child: Row(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              const Text('• ', style: TextStyle(color: WebDeckTheme.primary)),
                                              Expanded(
                                                child: Text(
                                                  point,
                                                  style: const TextStyle(
                                                    fontSize: 12,
                                                    color: WebDeckTheme.textPrimary,
                                                    height: 1.4,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ],

                              const SizedBox(height: 12),

                              // Action Buttons
                              Row(
                                children: [
                                  TextButton.icon(
                                    icon: Icon(
                                      isExpanded ? Icons.expand_less : Icons.expand_more,
                                      size: 16,
                                    ),
                                    label: Text(isExpanded ? 'Hide Notes' : 'Key Takeaways'),
                                    style: TextButton.styleFrom(
                                      foregroundColor: WebDeckTheme.primary,
                                      visualDensity: VisualDensity.compact,
                                    ),
                                    onPressed: () {
                                      setState(() {
                                        if (isExpanded) {
                                          _expanded.remove(item.id);
                                        } else {
                                          _expanded.add(item.id);
                                        }
                                      });
                                    },
                                  ),
                                  const Spacer(),
                                  IconButton(
                                    icon: Icon(
                                      isBookmarked ? Icons.bookmark : Icons.bookmark_border,
                                      color: isBookmarked ? WebDeckTheme.accentGreen : WebDeckTheme.textSecondary,
                                      size: 18,
                                    ),
                                    tooltip: isBookmarked ? 'Remove Bookmark' : 'Bookmark to Saved',
                                    visualDensity: VisualDensity.compact,
                                    onPressed: () {
                                      setState(() {
                                        if (isBookmarked) {
                                          _bookmarked.remove(item.id);
                                        } else {
                                          _bookmarked.add(item.id);
                                        }
                                      });
                                    },
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.open_in_new, size: 16, color: WebDeckTheme.textSecondary),
                                    tooltip: 'Read Original Publication',
                                    visualDensity: VisualDensity.compact,
                                    onPressed: () async {
                                      final uri = Uri.parse(item.url);
                                      if (await canLaunchUrl(uri)) {
                                        await launchUrl(uri, mode: LaunchMode.externalApplication);
                                      }
                                    },
                                  ),
                                ],
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

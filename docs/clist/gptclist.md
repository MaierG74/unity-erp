# 2D Bin Packing for Grain-Constrained Guillotine Cutting

## Overview and Challenges  
Optimizing sheet cutting with **grain direction** and **guillotine cut** constraints is a specialized 2D bin packing problem. We must pack rectangular parts on standard sheets (e.g. 2700×1800mm) such that all cuts are full edge-to-edge slices (guillotine cuts), while respecting each part’s allowed orientation (grain direction). The goal isn’t just high material utilization, but **waste consolidation** – i.e. leaving one or a few large reusable offcuts rather than many small scraps. This shifts our objective: a layout with 60% yield and one large leftover is preferable to 65% yield fragmented into unusable slivers. Key considerations include:  

- **Grain Orientation:** Parts may demand a fixed orientation (lengthwise or crosswise grain) or be rotatable. This means some rectangles cannot be rotated 90°, which complicates packing since we effectively have different item types (some treated only in their given orientation, others can swap width/height).  
- **Guillotine Cuts:** All cut patterns must be achievable via sequential full-length cuts from one sheet edge to the other. L-shaped cuts or interior cutouts are not allowed【20†L241-L249】. This typically implies a recursive **hierarchical subdivision** of the sheet into rectangular blocks.  
- **Kerf Width:** Each cut removes ~3–4mm of material (saw blade thickness), which effectively introduces a spacing/gap. In practice, kerf can be accounted for by slightly expanding each part or subtracting kerf from cuts, but algorithmically it means ensuring no “overlap” and perhaps preferring fewer cuts (to reduce total kerf loss).  
- **Multiple Sheets:** If parts don’t all fit in one sheet, the algorithm should pack them into as few sheets as possible. This is essentially a bin-packing extension of the cutting stock problem.  
- **Waste Consolidation vs Utilization:** Traditionally, cutting optimization seeks to maximize used area. Here we also prioritize *quality of waste*. A large rectangular offcut (say 800×900mm) that can be saved for future use is far more valuable than the same area scattered in dozens of small bits. We define a *usable offcut* as any leftover piece ≥ ~150mm in both dimensions and area ≥ ~100,000 mm² (e.g. a 300×300mm square). Ideally, leftover pieces above 400mm on the short side (area > ~250,000 mm²) are even better. Anything smaller is considered scrap. These practical thresholds will guide our heuristics for waste scoring.  

With these in mind, we will survey suitable algorithms and heuristics, recommend the top approaches with pseudocode, and discuss how to incorporate waste consolidation into the optimization. We also compare trade-offs (speed, complexity, solution quality) and highlight edge cases for grain orientation.

## Candidate Algorithms Supporting Grain & Guillotine Constraints  
Several classes of algorithms are applicable, each with modifications to handle orientation and guillotine requirements:

**1. Shelf (Level) Algorithms – NFDH, FFDH, BFDH:**  
Shelf algorithms pack items in horizontal rows (levels) across the sheet【34†L125-L134】【34†L143-L151】. Each level’s height is the tallest item there; when an item doesn’t fit in a level, a new level is opened below it (a horizontal guillotine cut separates levels). Classic variants include:  

- *Next-Fit Decreasing Height (NFDH):* Take items sorted by height (tallest first). Place as many as fit in the first row; when the next item can’t fit in remaining width, start a new row【27†L7-L15】【27†L31-L39】. All items are left-justified.  
- *First-Fit Decreasing Height (FFDH):* Also uses height-sorted items, but tries to put each item into the earliest (lowest) shelf where it fits before resorting to a new shelf【28†L433-L441】. This tends to use vertical space more tightly than NFDH.  
- *Best-Fit Decreasing Height (BFDH):* Similar to FFDH, but places each item in the shelf that will *leave the least empty space* (width-wise) after placement【34†L149-L157】. This can yield higher packing density by filling shelves more completely.  

All these shelf algorithms inherently produce **guillotine-compliant patterns**, since items in a shelf can be cut with a vertical slice between them, and shelves are separated by full-width horizontal cuts【33†L1-L9】. They also naturally respect orientation constraints if we treat “no-rotation” items as having a fixed width and height (we only place them in given orientation). Grain constraints can be handled by simply not rotating pieces that have fixed grain direction; essentially, you prepare two lists: one for parts that must be placed as given, and another for parts that can be rotated (where you might choose an orientation that fits best per shelf). The shelf approach is **fast** (O(n²) or better【28†L442-L450】) and easy to implement with a simple data structure (just track remaining width on the current shelf and total height used).  

*Suitability:* Shelf algorithms are simple and deterministic. They ensure guillotine cuts by construction and easily handle grain (just decide orientation beforehand or disallow rotation per item). However, basic shelf heuristics prioritize packing efficiency and may leave lots of small gaps on each shelf (e.g. each shelf might end with some unused width). This means waste is scattered as multiple thin strips rather than one big piece. For example, FFDH will fill shelves one by one, leaving unused areas on the right side of each shelf and possibly a partial shelf at the bottom – potentially many offcuts【28†L479-L488】【28†L499-L507】. Pure shelf packing might yield ~60–65% utilization but produce many small offcuts along sheet edges. We may improve on this by combining shelf logic with other strategies (see hybrid approaches below). Shelf methods also don’t explicitly minimize the number of cuts; in fact, they can sometimes increase total cut length by creating many short cuts (every shelf introduces a horizontal cut, plus vertical cuts between parts). Still, as a base, shelf algorithms (especially FFDH/BFDH) are a good starting point due to their simplicity and guillotine guarantee【28†L472-L474】.

**2. Guillotine Recursive Partitioning (Free Rectangles):**  
Another approach maintains a list of free rectangles representing remaining empty areas on the sheet and places items one-by-one, splitting the free space each time. Your current implementation is of this type – a *greedy guillotine splitter*: it always places the next part into a free rectangle that leaves minimal leftover area, then splits the leftover space into two rectangles (one cut along the part’s right edge, one along its bottom edge, mimicking a guillotine cut). This is often called the **guillotine First-Fit** or **Best-Fit** algorithm in literature. It’s akin to an algorithm by Sleator or the generic “split algorithm” where each item placement yields two subspaces【28†L475-L484】【28†L499-L507】.  

Data structure-wise, you can use a binary tree to represent the cut subdivisions, or maintain an array of free rectangles. Each time you place a part, you remove one free rectangle and add up to two new ones (for the remaining right-hand strip and bottom strip). A common refinement is to try different heuristics for choosing which free rectangle to use for each part: e.g. **Best Area Fit** (minimize leftover area), **Best Short Side Fit**, etc. In your case, you tried sorting parts by area, perimeter, etc., which is another heuristic layer to influence the packing order. These free-rectangle guillotine algorithms tend to achieve decent packing density, but as you observed, they often produce many disjoint scraps – each placement carves out space and leaves multiple small regions unused unless another part fits perfectly. The result can be high fragmentation of waste.  

*Suitability:* This method is flexible and fairly easy to implement, but tends to optimize locally (greedy placements) rather than for a global waste pattern. It will honor grain constraints by simply not considering rotated placement for grain-fixed parts. The downside is exactly what you saw: maximizing immediate area usage can paradoxically *reduce* the value of the remaining offcuts, scattering waste into slivers. For example, filling a tiny gap might yield 2% more usage but break what could have been a single large leftover piece into two unusable scraps. Therefore, while the free-rectangle guillotine approach can be part of the solution, we should incorporate better heuristics to consolidate waste (see below on waste-aware scoring). 

**3. Hybrid Shelf + Bottom-Left (BL) Methods:**  
Hybrid algorithms combine the structured levels of shelf algorithms with the gap-filling of bottom-left placement. The idea is to maintain the guillotine-friendly row structure, but also utilize leftover space within each shelf more intelligently so that waste is consolidated. A prime example from research is the **Bottom-Left + FFDH hybrid**. One such algorithm is *Guillotinable Bottom-Left First-Fit Decreasing Height (BLFFDHg)*【35†L131-L139】【35†L103-L110】. In BLFFDHg, items are packed in horizontal levels (like FFDH) to ensure a guillotine pattern, *but* whenever a shelf has unused space beneath it, the algorithm tries to fill those “intra-level” gaps using a bottom-left strategy (placing smaller items into the gaps, anchored to the bottom-left of the gap)【35†L31-L39】. This effectively packs some items into sub-rectangles left over in each level, while still keeping cuts straight. The “bottom-left” part means within any free sub-rectangle, place the next item at the lowest, leftmost possible position (which tends to cluster items toward one corner of the space, leaving any waste in a single block). Research has shown that such hybrid methods yield better utilization than pure shelf or pure BL alone, without sacrificing the guillotine constraint【35†L131-L139】【35†L103-L110】. In fact, BLFFDHg was found to produce the best results in 87.5% of benchmark cases among guillotine-oriented heuristics (outperforming plain FFDH, etc.)【35†L103-L110】. Another related approach is **BLF2G**, a heuristic that places items in levels for guillotine compliance while “exploiting intra-level residues vertically then horizontally”【30†L112-L120】 – essentially a similar bottom-left fill of leftover spaces within each level. These methods are deterministic but incorporate more complex placement rules. 

From an implementation standpoint, you can maintain the free space in each level as smaller rectangles and apply a BL-type placement on those. The data structure might be a list of free gaps per level (initially the full shelf width minus placed items). When no more items fit in existing gaps on a level, you start a new shelf. By ensuring that any gap-filling doesn’t violate the straight-cut pattern (e.g. only fill gaps that align to the bottom of the shelf), you keep the result guillotine-cuttable. This keeps waste consolidated because any leftover on a shelf tends to be one contiguous rectangle (e.g. at the far right end if nothing fit there, or below the filled gaps). And if some shelves are completely filled except one shelf that ends early, the remaining bottom area of the sheet could end up as one big rectangle. Essentially, the hybrid tries to pack densely but if small items can’t perfectly fill a shelf’s width, it groups them to one side, preserving a larger empty chunk on the other side.

*Suitability:* A BL-shelf hybrid is highly promising for this use case. It directly addresses the waste fragmentation issue by biasing how gaps are filled. Rather than leaving multiple scattered voids, it tends to leave **one larger void per shelf or at sheet bottom**. It supports orientation easily (non-rotatable items just maintain their given dimensions in placement). The complexity is a bit higher than a plain greedy algorithm, but still quite manageable for 50–200 parts (these heuristics run in polynomial time and were tested on instances of similar or larger size【35†L131-L139】). We might need to be careful in coding to ensure all sub-gap placements still allow edge-to-edge cuts, but the literature provides guidance (e.g. only fill gaps that span the full height of the shelf, etc.). This approach likely yields better *usable offcuts*: for instance, it might fill all parts in a way that leaves the bottom-right corner of the sheet as one clean rectangle of unused material – exactly what we want.  

**4. Strip Packing with Variable Orientation:**  
The problem can also be seen as a **strip packing** (if we consider an infinitely long strip of width 1800 and try to minimize used length for each sheet). Many approximation algorithms exist for strip packing (with no rotation allowed in oriented case)【10†L52-L60】, including some advanced ones like *Split-Fit* (SF)【28†L475-L484】 and others. The Split-Fit algorithm by Coffman et al. is interesting as it deliberately partitions items into “wide” and “narrow” ones, packs wide ones in shelves, and then packs the narrow ones in the leftover column next to those shelves【28†L499-L507】. This guarantees a large contiguous empty area on one side if there are fewer narrow items – conceptually similar to consolidating waste. In effect, SF creates a reserved vertical strip (of width based on the widest items) where small items go, leaving a block on the right side empty if not needed【28†L499-L507】. While SF was designed for approximation ratio proofs, the idea of **reserving a strip or block for leftovers** could be applied: for example, decide to leave the rightmost X mm of the sheet unused (or used only by smaller pieces) so that if it’s not filled it remains one big offcut. This is a heuristic decision – essentially treating the sheet as two sections: a main area to pack most parts and a reserved leftover area. If the reserved area ends up needed for parts, you use it; if not, it becomes a nice rectangular offcut. 

*Suitability:* Such an approach might reduce overall utilization slightly (if the reserved area isn’t fully used), but it ensures the leftover is one piece. This is a strategic trade-off akin to “sacrificing a little yield to greatly improve leftover usability.” One could dynamically decide the reserve size based on total area of parts vs sheet area, or the size of largest part, etc. This isn’t a standard algorithm per se, but a strategy that can be layered on top of shelf or BL algorithms (e.g. pack everything but don’t cross a certain boundary, so that any remaining space beyond that boundary is contiguous). 

**5. Metaheuristic and Advanced Methods:**  
Beyond greedy heuristics, there are metaheuristic approaches (genetic algorithms, simulated annealing, tabu search, etc.) and even integer programming methods for this problem. Researchers have formulated oriented guillotine cutting as MILP and used Benders decomposition【2†L5-L8】 or applied genetic algorithms to optimize cut layouts【30†L113-L120】【30†L53-L58】. For example, one could use a GA where each chromosome is a packing pattern (or an ordering of parts for a heuristic) and evolve solutions that maximize a fitness function combining utilization and leftover size. There are also exact algorithms for guillotine cutting (using branch-and-bound or dynamic programming) that guarantee optimal layouts【32†L211-L219】, but those become too slow for 200 parts (NP-hard problem). 

*Suitability:* Given the requirement of ~1 second runtime, pure metaheuristics may be too slow to converge for large instances – but they could be feasible in an “optional optimize-harder mode” as you suggested. A GA or simulated annealing could start from a heuristic solution (e.g. the output of one of the above algorithms) and then try random swaps or pattern alterations to improve waste consolidation. This might find non-intuitive placements that yield a better leftover, at the cost of more compute time. If implemented in a controlled way (e.g. iterate for 2–3 seconds if the user requests extra optimization), it might squeeze out a few more percentage points or find a layout where the leftover becomes a single nice rectangle. There is precedent for evolutionary approaches improving packing results modestly【30†L53-L58】. However, the complexity of coding and maintaining a metaheuristic is higher, and the results are not as predictable (important in an ERP context where you want repeatable plans). So our primary recommendation will lean toward deterministic heuristics, with metaheuristics as an optional extension.

**6. Published Research Note:** The combination of **orientation + guillotine + usable leftovers** has been studied in academia under the “two-dimensional cutting stock problem with usable leftovers (2D-CSPUL)”【32†L52-L60】. In these formulations, leaving a leftover piece is considered beneficial: *“leftovers can be generated to reduce waste… a technique of great practical importance”*【32†L52-L60】. Researchers like Nascimento et al. (2022) propose heuristics that decompose the problem and intentionally produce large reusable offcuts【32†L52-L60】. While those are advanced, they reinforce that our goal (maximizing usable leftover area) is well-founded. We will draw on some of those insights (e.g. treating a leftover as a valued outcome rather than zero). 

## Top Recommended Approaches (Ranked)  
Considering the requirements, here are the algorithmic approaches ranked by suitability for our use case:

**1. *Hybrid Level+Gap Packing* (e.g. BLFFDHg variant)** – **Most Recommended**  
This deterministic approach combines the strengths of shelf (level-by-level packing for guillotine cuts) with intelligent gap filling (bottom-left style) to reduce fragmented waste. It can be implemented as a single-pass heuristic that is fast and predictable. Crucially, it keeps waste consolidated by ensuring each shelf’s empty space is either filled with parts or left as one block. Given the success of algorithms like BLFFDHg in literature, this is a top choice【35†L131-L139】【35†L103-L110】. It fits our environment (TypeScript implementation is straightforward using arrays of free spaces per level) and should handle 50–200 parts easily under 1s. We will provide pseudocode for this approach below.

**2. *Enhanced Guillotine Greedy with Waste Scoring*** – **Highly Recommended**  
If we build on your current free-rectangle greedy algorithm, we can add a **waste consolidation heuristic** to its decisions. This means altering how we choose placements: instead of purely minimizing leftover area for each piece, we score each potential placement by a combination of factors – including how it will affect the largest leftover piece or create scraps. For example, prefer placements that leave one large rectangle free over those leaving two medium rectangles, even if the immediate used area is slightly less. This approach can be realized by modifying the selection criteria in the free-space list algorithm. It’s a relatively small change to your existing code, preserving its speed. The challenge is designing a good scoring function (we discuss this in the next section). This method is also deterministic and fast, and it leverages the code you already have. We rank it second only because it may require more tuning to get the waste heuristic right. It’s a pragmatic improvement path in parallel with trying the hybrid level method.

**3. *Shelf (FFDH/BFDH) with Post-Optimization*** – **Recommended for Simplicity**  
As a simpler alternative, you could use a plain shelf algorithm (FFDH or BFDH) to get an initial layout, then apply a **post-processing step** to consolidate waste. For instance, if the shelf algorithm leaves several small strips, you could attempt to merge some by moving parts between shelves or shifting a part from one shelf to another to free up an entire shelf. Another post-processing idea: identify if there is a large contiguous rectangular space (like the bottom-right corner) and see if moving one or two parts could enlarge that leftover area. While shelf algorithms alone don’t optimize leftover, their structured nature (rows and columns of parts) makes it easier to identify a big leftover region (often the bottom-right). This approach trades some optimality for simplicity and maintainability – it’s basically using a known heuristic and then doing a localized improvement for waste. It might not reach the efficiency of the above two methods, but it’s easier to reason about and implement. Given your preference for deterministic, this is a safe middle-ground option.

**4. *Metaheuristic Guided Search* – **Optional “High-Optimization” Mode**  
As an optional mode, allow the user to enable an iterative improvement search (GA or simulated annealing) after a heuristic layout is produced. This could randomly swap part placements or alter the order and re-pack, evaluating by a fitness that heavily rewards a large single offcut. For example, a genetic algorithm could encode the order of parts to pack and use the hybrid level algorithm as the decoder (so each “individual” yields a packing). This can explore patterns that a greedy heuristic might miss. We suggest this as an **opt-in** because it will be slower and non-deterministic. But for tough cases or very high-value materials, a user might accept a 5-second run for an extra 2% yield or a much nicer leftover piece. Metaheuristics have been shown to improve layouts when combined with heuristics【30†L53-L58】, though often the gains are small (a few percentage points or a better distribution of waste).

**5. *Exact or Advanced Mathematical Algorithms* – **Not Practical for 1s but Noted***  
Methods like integer linear programming or branch-and-bound tailored to guillotine cuts exist and can find optimal solutions for moderate-sized instances. For example, there are exact algorithms for orthogonal guillotine cutting that could be applied【32†L211-L219】, and mathematical models that incorporate usable leftovers【18†L52-L60】. However, with 50–200 parts, these will not solve in under 1 second (they might take minutes or more). They also require substantial implementation effort or usage of an MILP solver. Thus, we don’t recommend them for real-time use in your ERP, but it’s useful to know the optimal benchmarks from literature to gauge how close our heuristics are (often heuristics are within a few percentage points of optimal【25†L139-L147】).

In summary, we suggest focusing on a **hybrid shelf+gap algorithm** and an enhanced **waste-aware guillotine algorithm**, as these directly target the grain + guillotine + leftover quality requirements. Next, we detail how to implement the top approach and how to incorporate waste consolidation heuristics.

## Pseudocode for a Hybrid Level-Fill Algorithm (BLFFDHg-like)  
Below is pseudocode for a **Guillotine Level-Fill Heuristic** that aligns with the BLFFDHg idea. This will pack parts into shelves (levels) and fill intra-shelf gaps as much as possible, while keeping cuts guillotine-compliant. We assume all parts have either `canRotate = true/false` or a grain direction flag (‘length’ or ‘width’ which we translate into a fixed orientation), and we have the sheet dimensions `SheetWidth` and `SheetHeight`. We also assume parts are pre-sorted in a sensible order (more on that after the code). 

```plaintext
// Input: list of parts (with width, height, grain orientation), sheet width/height.
parts = sortPartsByHeightDescending(parts)  // common for level algorithms
for each part in parts:
    part.orient = 0° (no rotation) 
    if part.grain == 'width': 
        part.orient = 90°  // rotate so that part.length aligns with sheet width
    if part.grain == 'any':
        // Choose orientation that makes part.width <= SheetWidth (if both fit, maybe leave as is for now)
        if part.width > SheetWidth and part.height <= SheetWidth:
            rotate part 90° 
        // (More complex orientation choice could consider fitting in current gaps)

levels = []  // Each level will have properties: y_position, height, remainingWidth, freeGaps list

newLevel(y=0, height = parts[0].height, remainingWidth = SheetWidth)
levels.add(level0)
place part[0] at (x=0, y=0) in level0
level0.remainingWidth -= part[0].width
level0.freeGaps = []  // We'll represent free space in a level as gaps (x, width, availableHeight)

for i = 1 to parts.length-1:
    p = parts[i]
    // Try to place p in an existing level (First-Fit Decreasing Height strategy)
    placed = false
    for each level in levels: 
        if p.height <= level.height:
            // Check if it fits in some free gap or at end of level
            if p.width <= level.remainingWidth:
                // Place at end of level (rightmost position)
                xPos = SheetWidth - level.remainingWidth
                yPos = level.y_position
                place p at (xPos, yPos)
                level.remainingWidth -= p.width
                placed = true
                break
            else 
                // Try to fit into an existing gap within this level
                for each gap in level.freeGaps:
                    if p.width <= gap.width AND p.height <= gap.availableHeight:
                        // Place p in this gap, aligned to gap's bottom-left
                        place p at (gap.x, level.y_position + (level.height - gap.availableHeight))
                        // Update gap or split gap
                        newGapX = gap.x + p.width + kerf   // kerf allowance if needed
                        remainingGapWidth = gap.width - (p.width + kerf)
                        if remainingGapWidth > 0:
                           // shrink the current gap to the remaining space on right
                           gap.x = newGapX
                           gap.width = remainingGapWidth
                        else:
                           remove gap from level.freeGaps
                        // also reduce gap.availableHeight if p.height used part of it
                        // (In a guillotine pattern, p.height should equal gap.availableHeight ideally)
                        placed = true
                        break
        if placed: break
    if not placed:
        // Open a new level (shelf) below the others
        currentY = sum of heights of all levels used
        if currentY + p.height > SheetHeight:
            // sheet full, would need new sheet (not shown here for simplicity)
        newLevel(y = currentY, height = p.height, remainingWidth = SheetWidth)
        place p at (x=0, y=currentY)
        level.remainingWidth -= p.width
        levels.add(level)
```

## Integrating Waste Consolidation Heuristics  
To systematically favor large contiguous waste, we introduce a **waste quality scoring** into the packing decisions. Whether using the free-rectangle method or the above level-fill method, we can evaluate layouts (or partial layouts during construction) with metrics beyond raw utilization:

**Possible Waste Metrics:**  
- **Largest Offcut Area**  
- **Number of Usable Offcuts**  
- **Waste Rectangularity/Location**

A generic full-layout score:
`Score = α * UsedArea + β * LargestOffcutArea – γ * (NumOffcuts) – δ * TotalCutLength`

## Trade-offs Between Approaches  
- **Simple Shelf Algorithms:** fast, simple, deterministic; weaker offcut quality unless augmented.  
- **Greedy Free-Rectangles:** flexible, often good utilization; tends to fragment waste without waste-aware scoring.  
- **Hybrid Level-Fill:** best balance of utilization and offcut consolidation; more complex but still manageable.  
- **Metaheuristics:** optional “optimize harder” mode; slower and less predictable, but may find better layouts.  

## Edge Cases and Grain Constraint Considerations  
- Validate grain-locked parts fit in their required orientation.  
- Treat `grain='width'` parts as pre-rotated 90° and then fixed.  
- For `grain='any'` parts, try both orientations when evaluating candidate placements.  
- Avoid creating slivers under ~150mm (dimension threshold) by penalizing such placements.  
- Kerf accumulation can turn “barely usable” offcuts into scrap; bias offcut thresholds upward by expected cut count.  

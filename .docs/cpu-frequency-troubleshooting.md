# CPU Frequency & Thermal Troubleshooting Guide

Diagnose and fix CPU frequency locks, thermal throttling, and BIOS/ACPI issues on Linux.

## Symptoms

- CPU frequency locked below hardware maximum
- System performance degraded

## Diagnostic Commands

### Check Current CPU Frequency Status

```bash
# Check current, min, max frequencies for CPU0
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_min_freq
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq
cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq  # Hardware limit

# Check all CPUs at once
for i in /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_max_freq; do 
    echo "$i: $(cat $i)"
done

# Detailed view with cpupower
sudo cpupower frequency-info
```

**What to look for:**
- `scaling_max_freq` should equal `cpuinfo_max_freq`
- If they differ, something is limiting CPU frequency

### Check Intel P-state Driver

```bash
# Check driver status
cat /sys/devices/system/cpu/intel_pstate/status
cat /sys/devices/system/cpu/intel_pstate/max_perf_pct
cat /sys/devices/system/cpu/intel_pstate/min_perf_pct
cat /sys/devices/system/cpu/intel_pstate/no_turbo

# List all pstate parameters
ls -la /sys/devices/system/cpu/intel_pstate/
```

**Expected values:**
- `status`: active
- `max_perf_pct`: 100
- `no_turbo`: 0 (turbo enabled)

### Check Thermal Zones & Throttling

```bash
# List all thermal zones and their temperatures
for tz in /sys/class/thermal/thermal_zone*; do
    echo "$(basename $tz): $(cat $tz/type) = $(cat $tz/temp)°C ($(cat $tz/temp | awk '{print $1/1000}')°C)"
done

# Check trip points for thermal zone 0
for i in 0 1 2 3; do
    if [ -f /sys/class/thermal/thermal_zone0/trip_point_${i}_temp ]; then
        echo "Trip point $i: $(cat /sys/class/thermal/thermal_zone0/trip_point_${i}_temp) ($(cat /sys/class/thermal/thermal_zone0/trip_point_${i}_type))"
    fi
done

# Check cooling device states (Processor throttling)
for cd in /sys/class/thermal/cooling_device*; do
    name=$(cat $cd/type 2>/dev/null)
    state=$(cat $cd/cur_state 2>/dev/null)
    max=$(cat $cd/max_state 2>/dev/null)
    echo "$(basename $cd): $name - state=$state/$max"
done
```

**Red flags:**
- Trip points at absurdly low temperatures (e.g., 16.8°C for passive throttling)
- Processor cooling devices at max state (e.g., 3/3) when idle
- Thermal zones constantly at/above trip points

### Check BIOS Information

```bash
# Current BIOS version and date
sudo dmidecode | grep -A 3 "BIOS Information"

# Or more direct:
cat /sys/class/dmi/id/bios_vendor
cat /sys/class/dmi/id/bios_version
cat /sys/class/dmi/id/bios_date
cat /sys/class/dmi/id/board_vendor
cat /sys/class/dmi/id/board_name
```

**Check if BIOS is outdated:**
- Compare date with vendor's support page
- Old BIOS (>2 years) may have ACPI bugs

## Common Root Causes

1. **Buggy ACPI Tables** - Incorrect thermal trip points in BIOS causing unnecessary throttling. **Solution:** Update BIOS.

2. **Intel PCH Thermal Issues** - Platform Controller Hub overheating triggers preventive throttling. Check: `journalctl -b -p warning | grep pch_thermal`

3. **Power Management Conflicts** - TLP, laptop-mode-tools, or auto-cpufreq interfering. Check: `systemctl list-units | grep -iE "tlp|laptop|cpufreq|power"`

## Example Case: Outdated BIOS

**Symptoms:** CPU locked at 40% of max frequency, cooling devices at max throttle (3/3) even when idle, absurdly low thermal trip points (e.g., 16.8°C).

**Diagnosis:** Check thermal zones and trip points. If trip points are impossibly low, the BIOS has buggy ACPI tables.

**Solution:** Update BIOS. In this case, updating from a 6-year-old BIOS fixed all issues immediately.

## Fixing BIOS Issues on Linux

Many motherboard vendors provide BIOS update utilities accessible from the UEFI/BIOS itself (no OS required). Check your motherboard manual for specific instructions.

For detailed Linux BIOS update methods, see: [Arch Wiki: Flashing BIOS from Linux](https://wiki.archlinux.org/title/Flashing_BIOS_from_Linux)

## Temporary Workarounds

### Manually Reset CPU Frequency

```bash
# Reset scaling_max_freq to hardware max for all CPUs
for cpu in /sys/devices/system/cpu/cpu[0-9]*; do
    if [ -f "$cpu/cpufreq/cpuinfo_max_freq" ]; then
        max=$(cat $cpu/cpufreq/cpuinfo_max_freq)
        echo $max | sudo tee $cpu/cpufreq/scaling_max_freq
    fi
done
```

### Disable Buggy Thermal Zone

```bash
# Disable thermal zone 0 (DANGEROUS - only if confirmed buggy)
echo disabled | sudo tee /sys/class/thermal/thermal_zone0/mode
```

**Warning:** These are temporary fixes. Proper solution is BIOS update.

## Prevention

- Keep BIOS updated (check quarterly for CPU microcode, ACPI fixes, security patches)
- Monitor CPU frequency periodically to detect throttling issues early

## References

- [Arch Wiki: Flashing BIOS from Linux](https://wiki.archlinux.org/title/Flashing_BIOS_from_Linux)
- [Kernel Documentation: CPU Frequency Scaling](https://www.kernel.org/doc/html/latest/admin-guide/pm/cpufreq.html)
